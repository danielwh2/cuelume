/**
 * The audio engine — synthesizes each sound live via the Web Audio API
 * on one shared, lazily created `AudioContext`. No audio files, no
 * dependencies. Every sound carries a gentle envelope instead of a hard
 * transient, so nothing feels harsh, and every sound rings faintly into one
 * shared room, so it sounds placed in a space rather than inside your head.
 *
 * Each layer swells in along a straight line and dies away exponentially. A
 * straight swell is heard from its first moment; an exponential one stays
 * silent for most of its length and then jumps in, heard as a late second hit.
 */

import {
  resolveSound,
  type LegacySoundName,
  type NoiseLayer,
  type SoundLayer,
  type SoundName,
  type SoundRecipe,
  type ToneLayer,
  type Variation,
} from "../sounds/recipes.js";
import {
  arrangement,
  contextFrom,
  layerFactors,
  resolveEmphasis,
  shapeFor,
  type Context,
  type Emphasis,
  type InputMethod,
  type KeyRole,
  type Shape,
} from "../sounds/context.js";
import { THEMES, isThemeName, type ThemeName } from "../sounds/themes.js";

const SOURCE_STOP_PADDING = 0.05;
const OUTPUT_GAIN = 4;
/**
 * Every play starts this far ahead of the context's clock. A cold renderer
 * can let a source scheduled for "now" slip past, and a short cue then
 * plays nothing at all.
 */
const PLAYBACK_LEAD = 0.01;
/** A suspended context never ends its sources, so a play is let go this long after it should have finished. */
const CLEANUP_FALLBACK = 1;

/** Holds `param` at `from`, then glides it toward the layer's `glideTo`, if any. */
function glide(param: AudioParam, from: number, layer: SoundLayer, startTime: number): void {
  param.setValueAtTime(from, startTime);
  if (layer.glideTo === undefined) return;
  param.exponentialRampToValueAtTime(layer.glideTo, startTime + (layer.glideTime ?? layer.attack + layer.decay));
}

/** Swells `param` to the layer's peak along a straight line, then lets it die away. */
function envelope(param: AudioParam, layer: SoundLayer, startTime: number): void {
  param.setValueAtTime(0, startTime);
  param.linearRampToValueAtTime(layer.peak, startTime + layer.attack);
  param.exponentialRampToValueAtTime(0.0001, startTime + layer.attack + layer.decay);
}

function renderTone(
  context: AudioContext,
  destination: AudioNode,
  layer: ToneLayer,
  startTime: number,
): AudioScheduledSourceNode {
  const oscillator = context.createOscillator();
  oscillator.type = layer.waveform;
  glide(oscillator.frequency, layer.frequency, layer, startTime);
  if (layer.detune) oscillator.detune.value = layer.detune;

  const gain = context.createGain();
  envelope(gain.gain, layer, startTime);

  oscillator.connect(gain).connect(destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + layer.attack + layer.decay + SOURCE_STOP_PADDING);
  return oscillator;
}

function renderNoise(
  context: AudioContext,
  destination: AudioNode,
  layer: NoiseLayer,
  startTime: number,
): AudioScheduledSourceNode {
  const duration = layer.attack + layer.decay + SOURCE_STOP_PADDING;
  const source = context.createBufferSource();
  source.buffer = getNoise(context);
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = layer.filterType;
  glide(filter.frequency, layer.filterFrequency, layer, startTime);
  if (layer.filterQ !== undefined) filter.Q.value = layer.filterQ;

  const gain = context.createGain();
  envelope(gain.gain, layer, startTime);

  source.connect(filter).connect(gain).connect(destination);
  // a different stretch of the same noise every time
  source.start(startTime, Math.random() * NOISE_SECONDS);
  source.stop(startTime + duration);
  return source;
}

function sourceEnd(layers: SoundLayer[]): number {
  return Math.max(
    ...layers.map(
      (layer) => (layer.offset ?? 0) + layer.attack + layer.decay + SOURCE_STOP_PADDING,
    ),
  );
}

/** Seconds of shared noise. Noise layers loop it from a random point, so none is made per play. */
const NOISE_SECONDS = 2;
let sharedNoise: AudioBuffer | null = null;

function getNoise(context: AudioContext): AudioBuffer {
  if (sharedNoise) return sharedNoise;
  const length = Math.max(1, Math.floor(NOISE_SECONDS * context.sampleRate));
  sharedNoise = context.createBuffer(1, length, context.sampleRate);
  const data = sharedNoise.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = 2 * Math.random() - 1;
  return sharedNoise;
}

/**
 * The shared room: a short, dense burst of reflections that dies away over
 * ROOM_SECONDS. Reflections within the first 80 ms or so are what move a sound
 * out of the listener's head (Begault); a longer tail only adds distance. Its
 * two channels are independent noise, so the room is wide while the sound
 * itself stays centred.
 */
const ROOM_SECONDS = 0.25;
/** The gap before the first reflection: a small room's nearest wall. */
const ROOM_PREDELAY = 0.008;
/** Reflections are low-passed here: walls swallow the highs first. */
const ROOM_LOWPASS = 3500;
/** Lowpass Q in dB that gives a flat, unresonant corner. Web Audio reads a lowpass Q in dB. */
const FLAT_Q = -3;
/** How much of every cue reaches the room: about 22 dB down, faint enough to feel rather than hear. */
const ROOM_SEND = 0.08;
/** 60 dB of decay, the conventional end of a room's tail. */
const ROOM_DECAY_DB = 60;

let sharedOutput: GainNode | null = null;
let sharedRoom: AudioNode | null = null;

/** Builds the room once, feeding `output`; returns the node sends connect to. */
function buildRoom(context: AudioContext, output: AudioNode): AudioNode {
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(ROOM_SECONDS * rate));
  const impulse = context.createBuffer(2, length, rate);
  // amplitude falls by ROOM_DECAY_DB over the length of the room
  const fall = (ROOM_DECAY_DB / 20) * Math.LN10;
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let energy = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      data[i] = t < ROOM_PREDELAY ? 0 : (2 * Math.random() - 1) * Math.exp((-fall * t) / ROOM_SECONDS);
      energy += data[i] * data[i];
    }
    // unit energy: a send's gain is then the room's level against the dry sound
    const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
  const convolver = context.createConvolver();
  convolver.normalize = false;
  convolver.buffer = impulse;

  const walls = context.createBiquadFilter();
  walls.type = "lowpass";
  walls.frequency.value = ROOM_LOWPASS;
  walls.Q.value = FLAT_Q;

  walls.connect(convolver).connect(output);
  return walls;
}

function getOutput(context: AudioContext): GainNode {
  if (sharedOutput) return sharedOutput;

  const output = context.createGain();
  output.gain.value = OUTPUT_GAIN;

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;

  output.connect(limiter).connect(context.destination);
  sharedOutput = output;
  sharedRoom = buildRoom(context, output);
  return output;
}

const nudge = (amount: number) => 1 + (Math.random() * 2 - 1) * amount;

/**
 * One play's strike: how high the object sounds and how hard it was hit. Every
 * layer shares it, so a harder strike is louder and brighter at once, as a
 * real one is, rather than each layer drifting on its own.
 */
type Strike = { pitch: number; force: number };
const STEADY_STRIKE: Strike = { pitch: 1, force: 1 };

/** Within one strike, each layer's ring length moves by up to this: same object, a slightly different hit. */
const DECAY_JITTER = 0.1;
/** And each tone's pitch by up to this, about 9 cents: the object's modes never sit exactly the same twice. */
const MODE_JITTER = 0.005;

/** How long a cue's last play takes to fade when the same cue plays again, in seconds. */
const RELEASE_TIME = 0.08;
/**
 * Each cue's latest voice. A cue plays one voice at a time, like one key under
 * one finger: playing it again releases the last play instead of stacking on
 * it. Other cues ring on.
 */
const voices = new Map<SoundName, GainNode>();

/**
 * A copy of `layer` bent by the play's context shape and its strike. A cue
 * with `vary` also moves each layer's ring and tone a little on its own, so no
 * two plays match; one without plays exactly. A harder strike raises a noise
 * layer's filter with its level: louder is brighter. A reversed sweep starts
 * where it would have ended. `time` moves every layer's start, and a
 * `stretch` layer lasts as long as the count.
 */
function shaped(layer: SoundLayer, shape: Shape, strike: Strike, vary?: Variation): SoundLayer {
  const factors = layerFactors(layer, shape);
  const tune = layer.kind === "tone" ? (vary ? nudge(MODE_JITTER) : 1) : strike.force;
  const pitch = factors.pitch * strike.pitch * tune;
  const peak = layer.peak * factors.gain * strike.force;
  const stretch = layer.stretch ? shape.time : 1;
  const decay = layer.decay * factors.length * stretch * (vary ? nudge(DECAY_JITTER) : 1);
  const start = layer.kind === "tone" ? layer.frequency : layer.filterFrequency;
  const [from, to] = shape.sweep < 0 && layer.glideTo !== undefined ? [layer.glideTo, start] : [start, layer.glideTo];
  const glideTo = to === undefined ? undefined : to * pitch;
  const timing = {
    offset: (layer.offset ?? 0) * shape.time,
    attack: layer.attack * stretch,
    glideTime: layer.glideTime === undefined ? undefined : layer.glideTime * stretch,
  };
  return layer.kind === "tone"
    ? { ...layer, ...timing, frequency: from * pitch, glideTo, peak, decay }
    : { ...layer, ...timing, filterFrequency: from * pitch, glideTo, peak, decay };
}

function renderRecipe(
  context: AudioContext,
  sound: SoundName,
  recipe: SoundRecipe,
  volume: number,
  emphasis: Emphasis,
  shape: Shape,
): void {
  const now = context.currentTime;
  const output = getOutput(context);
  const master = context.createGain();
  master.gain.value = recipe.masterGain * volume;
  master.connect(output);
  const send = context.createGain();
  send.gain.value = ROOM_SEND * (recipe.room ?? 1);
  master.connect(send).connect(sharedRoom!);

  const last = voices.get(sound);
  if (last) {
    last.gain.setValueAtTime(last.gain.value, now);
    last.gain.exponentialRampToValueAtTime(0.0001, now + RELEASE_TIME);
  }
  voices.set(sound, master);

  const { vary } = recipe;
  const strike = vary ? { pitch: nudge(vary.pitch), force: nudge(vary.level) } : STEADY_STRIKE;
  const layers = arrangement(recipe.layers, emphasis).map((layer) => shaped(layer, shape, strike, vary));
  const sources = layers.map((layer) => {
    const startTime = now + PLAYBACK_LEAD + (layer.offset ?? 0);
    return layer.kind === "tone"
      ? renderTone(context, master, layer, startTime)
      : renderNoise(context, master, layer, startTime);
  });

  // the room rings on by itself once the last source has fed it
  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    if (voices.get(sound) === master) voices.delete(sound);
    master.disconnect();
    send.disconnect();
  };
  let playing = sources.length;
  for (const source of sources) {
    source.onended = () => {
      if (--playing === 0) cleanup();
    };
  }
  setTimeout(cleanup, (PLAYBACK_LEAD + sourceEnd(layers) + CLEANUP_FALLBACK) * 1000);
}

let sharedContext: AudioContext | null = null;
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

/** When each cue last played, for cadence. Page memory only; never stored. */
const lastPlayedAt = new Map<SoundName, number>();

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

/** `play`, plus what a binding knows about the interaction. Internal to cuelume. */
export function playInContext(sound: unknown, options: PlayOptions | undefined, interaction: Context): void {
  const name = resolveSound(sound);
  if (!enabled || !name) return;
  if (typeof navigator !== "undefined" && navigator.userActivation?.hasBeenActive === false) return;

  const playVolume = globalVolume * normalizeVolume(options?.volume, 1);
  if (playVolume === 0) return;

  const context = getAudioContext();
  if (!context) return;

  const requested = options?.theme;
  const recipe: SoundRecipe = THEMES[isThemeName(requested) ? requested : activeTheme][name];
  const emphasis = resolveEmphasis(options?.emphasis);
  const shape = shapeFor(name, interaction, emphasis, sinceLastPlay(name));
  if (context.state === "running") {
    renderRecipe(context, name, recipe, playVolume, emphasis, shape);
  } else {
    try {
      void context.resume().then(
        () => {
          if (enabled && context.state === "running") renderRecipe(context, name, recipe, playVolume, emphasis, shape);
        },
        () => {},
      );
    } catch {
      // Some browsers throw synchronously when audio is blocked.
    }
  }
}
