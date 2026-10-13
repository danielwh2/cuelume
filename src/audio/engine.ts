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
import { createOutput, type OutputBus } from "./output.js";
import { renderRecipe, type Part, type Played, type Voices } from "./render.js";

export type { Part } from "./render.js";

/** Repeats closer than this walk on to the next step; a longer pause starts the walk again. */
const WALK_GAP_MS = 1000;

let sharedContext: AudioContext | null = null;
let sharedBus: OutputBus | null = null;
const voices: Voices = new Map();
let enabled = true;
let globalVolume = 1;
let activeTheme: ThemeName = "default";

function normalizeVolume(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

/** Enables or disables future playback. Preference storage stays with the app. */
export function setEnabled(value: boolean): void {
  if (typeof value === "boolean") enabled = value;
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
 * the shared `AudioContext` on first use, resumes it if the browser
 * started it suspended (e.g. before any user gesture), and is a no-op
 * when Web Audio is unavailable (SSR, old browsers).
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
  if (typeof navigator !== "undefined" && navigator.userActivation?.hasBeenActive === false) return;

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

  if (context.state === "running") {
    renderRecipe(context, getBus, voices, name, played, part);
  } else {
    try {
      void context.resume().then(
        () => {
          if (enabled && context.state === "running") renderRecipe(context, getBus, voices, name, played, part);
        },
        () => {},
      );
    } catch {
      // Some browsers throw synchronously when audio is blocked.
    }
  }
}
