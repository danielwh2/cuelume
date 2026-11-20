/**
 * The audio engine — the public playback API (`play`, `press`, `release`,
 * settings) and the shared `AudioContext` lifecycle. It decides what to
 * play; render.ts decides how it sounds, output.ts where it goes.
 * No audio files, no dependencies: synthesis happens live in render.ts.
 */

import type { SoundRecipe } from "../sounds/layers.js";
import { resolveSound, type LegacySoundName, type SoundName } from "../sounds/recipes.js";
import {
  contextFrom,
  resolveEmphasis,
  shapeFor,
  type Context,
  type Emphasis,
  type InputMethod,
  type KeyRole,
} from "../sounds/context.js";
import { THEMES, isThemeName, type ThemeName } from "../sounds/themes.js";
import { createOutput, getNoise, silence, type OutputBus } from "./output.js";
import { renderRecipe, type Part, type Played, type Voices } from "./render.js";

export type { Part } from "./render.js";

/** Repeats closer than this walk on to the next step; a longer pause starts the walk again. */
const WALK_GAP_MS = 1000;

let sharedContext: AudioContext | null = null;
let sharedBus: OutputBus | null = null;
const voices: Voices = new Map();
/** The latest play waiting for the context to start; earlier ones would all start at once and add up. */
let waiting: { played: Played; part: Part; askedAt: number; render: (part: Part) => void } | null = null;
let enabled = true;
let globalVolume = 1;
let activeTheme: ThemeName = "default";

function normalizeVolume(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

/**
 * Turns sound on or off. Off is heard at once: whatever is ringing fades
 * within a few milliseconds, and a press waiting for its release is forgotten.
 * Preference storage stays with the app.
 */
export function setEnabled(value: boolean): void {
  if (typeof value !== "boolean") return;
  enabled = value;
  if (value) return;
  disarm();
  held.clear();
  voices.clear();
  waiting = null;
  if (sharedContext && sharedBus) silence(sharedContext, sharedBus);
  // nothing left to ring out, so let go of the audio device now; otherwise the last play's end does
  if (sharedContext && sounding === 0) suspend(sharedContext);
}

/**
 * Switches the material of future playback. Sounds already playing finish as
 * they started; unknown names are ignored. Preference storage stays with the app.
 */
export function setTheme(theme: ThemeName): void {
  if (isThemeName(theme)) activeTheme = theme;
}

/** Sets the volume multiplier for future playback. Preference storage stays with the app. */
export function setVolume(value: number): void {
  globalVolume = normalizeVolume(value, globalVolume);
}

/** Browsers refuse audio until the page has been interacted with; where they say so, cuelume doesn't ask. */
function isBlocked(): boolean {
  return typeof navigator !== "undefined" && navigator.userActivation?.hasBeenActive === false;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** The events browsers count as activation; audio can start on their call stack. */
const GESTURES = ["touchend", "click", "keydown", "mousedown"] as const;
/**
 * A cue still waiting on the context this long after it was asked for is dropped: it belongs to
 * the moment that asked for it, not to a later tap that finally starts audio.
 */
const STALE_CUE_MS = 1000;
let armed = false;

/**
 * Starts audio on the next gesture that counts. A play the browser blocks, before the page's first
 * activation (on iOS a swipe grants none) or off a gesture's call stack (after an await, where
 * resume() stays pending), would otherwise leave every later play silent too. Capture listeners on
 * window, so an element that stops propagation can't starve them; passive, so scrolling is untouched.
 */
function arm(): void {
  if (armed || typeof window === "undefined") return;
  if (typeof window.addEventListener !== "function" || typeof window.removeEventListener !== "function") return;
  armed = true;
  for (const type of GESTURES) window.addEventListener(type, onGesture, { capture: true, passive: true });
}

function disarm(): void {
  if (!armed) return;
  armed = false;
  for (const type of GESTURES) window.removeEventListener(type, onGesture, true);
}

function onGesture(): void {
  // a swipe's touchend grants no activation: keep waiting
  if (!enabled || isBlocked()) return;
  const context = getAudioContext();
  if (!context) disarm();
  else if (ready(context)) {
    disarm();
    flush(context);
  } else void wake(context);
}

/** Plays the cue waiting on the context, if it is still fresh. */
function flush(context: AudioContext): void {
  const next = waiting;
  waiting = null;
  if (next && enabled && context.state === "running" && now() - next.askedAt <= STALE_CUE_MS) next.render(next.part);
}

/**
 * How long the context sits idle, after the last play has been let go, before it is suspended. A
 * running context keeps the audio device open at its smallest buffer for as long as the page lives
 * (in Safari and WebKit views that makes other apps' audio crackle). Long enough for the room to
 * ring out and to ride through a burst of clicks; the next play resumes it.
 */
const IDLE_SUSPEND_MS = 1000;
/** Plays not yet let go. */
let sounding = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
/** A suspend in flight: the context still reads "running" but is about to stop. */
let suspending = false;

function idleSoon(context: AudioContext): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => suspend(context), IDLE_SUSPEND_MS);
}

/** Suspends a running, idle context; a missing, throwing or refused suspend() is ignored. */
function suspend(context: AudioContext): void {
  clearTimeout(idleTimer);
  if (suspending || sounding > 0 || context.state !== "running" || typeof context.suspend !== "function") return;
  suspending = true;
  const settled = () => {
    suspending = false;
  };
  try {
    context.suspend().then(settled, settled);
  } catch {
    settled();
  }
}

/** Renders a play and keeps the context running until it has been let go. */
function render(context: AudioContext, getBus: () => OutputBus, name: SoundName, played: Played, part: Part): void {
  const ended = () => {
    if (--sounding === 0) idleSoon(context);
  };
  if (!renderRecipe(context, getBus, voices, name, played, part, ended)) return;
  clearTimeout(idleTimer);
  sounding++;
}

/** Whether `context` can take a play now: running, and not about to suspend. */
const ready = (context: AudioContext) => context.state === "running" && !suspending;

/** Resumes `context` without surfacing a refusal; resolves whether it runs. */
function wake(context: AudioContext): Promise<boolean> {
  try {
    return context.resume().then(
      () => {
        if (context.state !== "running") return false;
        disarm();
        flush(context);
        // woken for nothing, such as a stale cue or unlock(): don't hold the device open
        if (sounding === 0) idleSoon(context);
        return true;
      },
      () => false,
    );
  } catch {
    // Some browsers throw synchronously when audio is blocked.
    return Promise.resolve(false);
  }
}

/**
 * Starts audio now rather than on the first cue. Call it from a user gesture,
 * such as the click that turns sound on: some browsers only start audio
 * there, and a cue played later from code would stay silent. Resolves `true`
 * once cues can sound, `false` while the browser still blocks audio or has no
 * Web Audio. Never rejects.
 */
export function unlock(): Promise<boolean> {
  if (isBlocked()) {
    arm();
    return Promise.resolve(false);
  }
  const context = getAudioContext();
  if (!context) return Promise.resolve(false);
  try {
    // build the output, room and noise now, so the first cue doesn't pay for them
    getNoise(context, (sharedBus ??= createOutput(context)));
  } catch {
    // A cue builds them itself if this fails.
  }
  if (ready(context)) {
    if (sounding === 0) idleSoon(context);
    return Promise.resolve(true);
  }
  return wake(context).then((running) => {
    if (!running) arm();
    return running;
  });
}

function getAudioContext(): AudioContext | null {
  if (sharedContext) return sharedContext;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedContext = new Ctor();
  } catch {
    return null;
  }
  return sharedContext;
}

export type PlayOptions = {
  /** Multiplier for this play only, clamped to 0–1. */
  volume?: number;
  /** How much the action matters. Invalid values play as "normal". */
  emphasis?: Emphasis;
  /** Which way the interaction moved. Shapes `select`; `back` plays `navigate`, `toggle` and `count` backwards. */
  direction?: "forward" | "back";
  /** Which key was typed. Shapes `type`. */
  key?: KeyRole;
  /** What did the activating. Shapes `tap`. */
  input?: InputMethod;
  /** How long a `count` runs, in milliseconds, clamped to 300–2000. Other cues ignore it. */
  duration?: number;
  /** The material for this play only; the active theme is unchanged. Unknown names play the active theme. */
  theme?: ThemeName;
};

/** When each cue last played, for cadence and the walk. Page memory only; never stored. */
const lastPlayedAt = new Map<SoundName, number>();
/** Where each cue is in its walk. */
const steps = new Map<SoundName, number>();
/** Presses still waiting for their release: one per cue, or one per gesture when a binding names it. */
const held = new Map<string, Played>();

function sinceLastPlay(sound: SoundName): number {
  const now = performance.now();
  const since = now - (lastPlayedAt.get(sound) ?? -Infinity);
  lastPlayedAt.set(sound, now);
  return since;
}

/**
 * Plays a sound immediately. Safe to call from anywhere — lazily creates
 * the shared `AudioContext` on first use, resumes it if it is suspended
 * (by the browser before any user gesture, or by cuelume once idle), and is
 * a no-op when Web Audio is unavailable (SSR, old browsers).
 */
export function play(sound?: SoundName, options?: PlayOptions): void;
/** @deprecated Renamed in v0.3 and removed in 1.0. See the migration table in the README. */
export function play(sound: LegacySoundName, options?: PlayOptions): void;
export function play(sound: SoundName | LegacySoundName = "tap", options?: PlayOptions): void {
  playInContext(sound, options, contextFrom(options));
}

/** The next step of `sound`'s walk: on while repeats come quickly, back to the first after a pause. */
function stepFor(sound: SoundName, recipe: SoundRecipe, sinceLastMs: number): number {
  const length = recipe.walk?.length ?? 0;
  const step = length > 0 && sinceLastMs < WALK_GAP_MS ? ((steps.get(sound) ?? -1) + 1) % length : 0;
  steps.set(sound, step);
  return step;
}

/**
 * Plays the press of a gesture that lets go later: call `release` with the
 * same cue when it lifts. For custom controls that don't use `bind()`, such as
 * a key that presses on pointerdown and lets go on pointerup.
 */
export function press(sound: SoundName = "tap", options?: PlayOptions): void {
  playInContext(sound, options, contextFrom(options), "press");
}

/** Lets go of the cue's last `press`. Plays nothing if that press already let go, or the theme has no release. */
export function release(sound: SoundName = "tap"): void {
  playInContext(sound, undefined, {}, "release");
}

/**
 * `play`, plus what a binding knows about the interaction. Internal to cuelume.
 * A binding plays the press as the gesture goes down and the release as it
 * lifts; a release with no press waiting plays nothing. `options` and
 * `interaction` are the press's: a release sounds like its press. `gesture`
 * names what is pressing, a key's code, so keys that overlap each let go of
 * their own press; without it a cue holds one press.
 */
export function playInContext(sound: unknown, options: PlayOptions | undefined, interaction: Context, part: Part = "both", gesture?: string): void {
  const name = resolveSound(sound);
  if (!enabled || !name) return;
  // blocked: this cue is dropped, but audio starts on the next gesture that counts
  if (isBlocked()) {
    arm();
    return;
  }

  const holding = gesture ? `${name}:${gesture}` : name;
  let played: Played;
  if (part === "release") {
    const pressed = held.get(holding);
    if (!pressed) return;
    held.delete(holding);
    played = pressed;
  } else {
    // the press before this one is over, even if this play turns out silent
    held.delete(holding);
    const volume = globalVolume * normalizeVolume(options?.volume, 1);
    if (volume === 0) return;
    const requested = options?.theme;
    const recipe: SoundRecipe = THEMES[isThemeName(requested) ? requested : activeTheme][name];
    const emphasis = resolveEmphasis(options?.emphasis);
    const since = sinceLastPlay(name);
    played = { recipe, volume, emphasis, shape: shapeFor(name, interaction, emphasis, since), step: stepFor(name, recipe, since) };
    if (part === "press") held.set(holding, played);
  }

  const context = getAudioContext();
  if (!context) return;
  // ponytail: bus built lazily inside render, only once a layer will actually sound
  const getBus = () => (sharedBus ??= createOutput(context));

  // a context about to suspend is resumed first, not rendered into
  if (ready(context)) {
    render(context, getBus, name, played, part);
  } else {
    // Every play still asks to resume (inside its own gesture), but only the latest one sounds when
    // the context starts: each waiting play would otherwise start at the same instant and add up.
    // A release joins its own waiting press into the whole cue; it never replaces another cue.
    if (part !== "release" || !waiting)
      waiting = { played, part, askedAt: now(), render: (as) => render(context, getBus, name, played, as) };
    else if (waiting.played === played && waiting.part === "press") waiting.part = "both";
    void wake(context);
    // off a gesture's call stack resume() can stay pending: the next gesture that counts starts it
    arm();
  }
}
