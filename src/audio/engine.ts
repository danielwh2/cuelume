/**
 * The audio engine — synthesizes each sound live via the Web Audio API
 * on one shared, lazily created `AudioContext`. No audio files, no
 * dependencies. Every sound carries a gentle envelope (and often a soft
 * shimmer tail) instead of a hard transient, so nothing feels harsh.
 */

import {
  RECIPES,
  isSoundName,
  type NoiseLayer,
  type Shimmer,
  type SoundName,
  type SoundRecipe,
  type ToneLayer,
} from "../sounds/recipes.js";

const SOURCE_STOP_PADDING = 0.05;
const CLEANUP_MARGIN = 0.05;
const INAUDIBLE_GAIN = 0.001;
const OUTPUT_GAIN = 4;

function renderTone(
  context: AudioContext,
  destination: AudioNode,
  layer: ToneLayer,
  startTime: number,
): void {
  const oscillator = context.createOscillator();
  oscillator.type = layer.waveform;
  oscillator.frequency.setValueAtTime(layer.frequency, startTime);
  if (layer.detune) oscillator.detune.value = layer.detune;

  if (layer.glideTo !== undefined) {
    const glideTime = layer.glideTime ?? layer.attack + layer.decay;
    oscillator.frequency.exponentialRampToValueAtTime(layer.glideTo, startTime + glideTime);
  }

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(layer.peak, startTime + layer.attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + layer.attack + layer.decay);

  oscillator.connect(gain).connect(destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + layer.attack + layer.decay + SOURCE_STOP_PADDING);
}

function renderNoise(
  context: AudioContext,
  destination: AudioNode,
  layer: NoiseLayer,
  startTime: number,
): void {
  const duration = layer.attack + layer.decay + SOURCE_STOP_PADDING;
  const length = Math.max(1, Math.floor(duration * context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = 2 * Math.random() - 1;

  const source = context.createBufferSource();
  source.buffer = buffer;

  const filter = context.createBiquadFilter();
  filter.type = layer.filterType;
  filter.frequency.value = layer.filterFrequency;
  if (layer.filterQ !== undefined) filter.Q.value = layer.filterQ;

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(layer.peak, startTime + layer.attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + layer.attack + layer.decay);

  source.connect(filter).connect(gain).connect(destination);
  source.start(startTime);
  source.stop(startTime + duration);
}

/** Wires a soft echo/shimmer send off `source`, feeding back into `destination`. */
function attachShimmer(
  context: AudioContext,
  source: AudioNode,
  destination: AudioNode,
  shimmer: Shimmer,
): AudioNode[] {
  const delay = context.createDelay(1);
  delay.delayTime.value = shimmer.delay;

  const feedbackFilter = context.createBiquadFilter();
  feedbackFilter.type = "lowpass";
  feedbackFilter.frequency.value = shimmer.lowpass;

  const feedbackGain = context.createGain();
  feedbackGain.gain.value = shimmer.feedback;

  const wetGain = context.createGain();
  wetGain.gain.value = shimmer.wet;

  source.connect(delay);
  delay.connect(feedbackFilter);
  feedbackFilter.connect(feedbackGain);
  feedbackGain.connect(delay);
  feedbackFilter.connect(wetGain);
  wetGain.connect(destination);

  return [delay, feedbackFilter, feedbackGain, wetGain];
}

function sourceEnd(recipe: SoundRecipe): number {
  return Math.max(
    ...recipe.layers.map(
      (layer) => (layer.offset ?? 0) + layer.attack + layer.decay + SOURCE_STOP_PADDING,
    ),
  );
}

function shimmerTail(shimmer?: Shimmer): number {
  if (!shimmer || shimmer.feedback <= 0) return 0;
  if (shimmer.feedback >= 1) return shimmer.delay;

  return shimmer.delay * (1 + Math.ceil(Math.log(INAUDIBLE_GAIN) / Math.log(shimmer.feedback)));
}

let sharedOutput: GainNode | null = null;

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
  return output;
}

function renderRecipe(context: AudioContext, recipe: SoundRecipe, volume: number): void {
  const now = context.currentTime;
  const output = getOutput(context);
  const master = context.createGain();
  master.gain.value = recipe.masterGain * volume;
  master.connect(output);

  const shimmerNodes = recipe.shimmer
    ? attachShimmer(context, master, output, recipe.shimmer)
    : [];

  for (const layer of recipe.layers) {
    const startTime = now + (layer.offset ?? 0);
    if (layer.kind === "tone") renderTone(context, master, layer, startTime);
    else renderNoise(context, master, layer, startTime);
  }

  const cleanupAfterMs = (sourceEnd(recipe) + shimmerTail(recipe.shimmer) + CLEANUP_MARGIN) * 1000;
  setTimeout(() => {
    master.disconnect();
    for (const node of shimmerNodes) node.disconnect();
  }, cleanupAfterMs);
}

let sharedContext: AudioContext | null = null;
let enabled = true;
let globalVolume = 1;
let disarmUnlock: (() => void) | null = null;

/** The gestures every engine accepts as a reason to start audio. */
const UNLOCK_EVENTS = ["touchend", "click", "keydown", "mousedown"] as const;

/** A cue still waiting on the context this long after it was asked for is
 * dropped: feedback belongs to the act that just landed, and a backlog
 * released by a later gesture would burst out as noise. */
const STALE_CUE_MS = 1000;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function normalizeVolume(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

/** Enables or disables future playback. Preference storage stays with the app. */
export function setEnabled(value: boolean): void {
  if (typeof value === "boolean") enabled = value;
}

/** Sets the volume multiplier for future playback. Preference storage stays with the app. */
export function setVolume(value: number): void {
  globalVolume = normalizeVolume(value, globalVolume);
}

/**
 * Gets audio started on the next gesture the browser honours.
 *
 * WebKit grants a page user activation only for a touch that ends as a tap,
 * never for a pan, and starts a context only while `resume()` runs on the
 * call stack of a `touchend`, `click`, `keydown` or `mousedown`. So a first cue played
 * from a swipe never passes the activation gate, and one played from a
 * pointer event listener, a frame callback or after an `await` leaves its
 * `resume()` pending; every later `play()` inherits that silence.
 *
 * Once `play()` or `prime()` has been blocked either way, one set of
 * passive capture listeners on `window` waits for the next honoured
 * gesture, creates the shared context there if it does not exist yet, and
 * calls `resume()` on that stack. Any pending promises then settle and the
 * cues queued behind them render. The listeners leave once the context
 * runs. Capture on `window` runs before any element's own handler, so an
 * app that stops a click's propagation (say, the click after a drag) does
 * not starve the unlock. A pen's activation event is `pointerup`; a
 * stylus browser that synthesizes no `mousedown` or `click` would need it
 * added here.
 */
function armUnlock(): void {
  if (disarmUnlock || typeof window === "undefined") return;
  if (typeof window.addEventListener !== "function") return;
  if (typeof window.removeEventListener !== "function") return;

  let watched: AudioContext | null = null;
  const disarm = () => {
    disarmUnlock = null;
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock, true);
    if (watched && typeof watched.removeEventListener === "function") {
      watched.removeEventListener("statechange", settle);
    }
  };
  const settle = () => {
    if (watched?.state === "running") disarm();
  };
  const watch = (context: AudioContext) => {
    if (watched) return;
    watched = context;
    if (typeof context.addEventListener === "function") {
      context.addEventListener("statechange", settle);
    }
  };
  const unlock = () => {
    if (!enabled || !userHasBeenActive()) return;
    const context = getAudioContext();
    if (!context) {
      disarm();
      return;
    }
    watch(context);
    // Running: nothing left to do. Closed: nothing can be done — a
    // closed context never resumes, so stop retrying on every gesture.
    if (context.state === "running" || context.state === "closed") {
      disarm();
      return;
    }
    tryResume(context, settle);
  };

  disarmUnlock = disarm;
  if (sharedContext) watch(sharedContext);
  for (const type of UNLOCK_EVENTS) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }
}

/** `resume()` without surfacing a rejection or a synchronous throw; a
 * resume that lands stands the unlock down. */
function tryResume(context: AudioContext, then: () => void): void {
  try {
    void context.resume().then(
      () => {
        try {
          if (context.state === "running") disarmUnlock?.();
          then();
        } catch {
          // A render that fails must not surface as an unhandled rejection.
        }
      },
      () => {},
    );
  } catch {
    // Some browsers throw synchronously when audio is blocked.
  }
}

function audioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

function getAudioContext(): AudioContext | null {
  if (sharedContext) return sharedContext;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    sharedContext = new Ctor();
  } catch {
    return null;
  }
  return sharedContext;
}

/**
 * Plays a sound immediately. Safe to call from anywhere — lazily creates
 * the shared `AudioContext` on first use, resumes it if the browser
 * started it suspended, and is a no-op when Web Audio is unavailable
 * (SSR, old browsers). A call the browser blocks — before the first user
 * activation, or off a gesture's call stack — plays nothing but gets the
 * context started on the next gesture that counts, so later cues play.
 */
export function play(sound: SoundName = "chime", options?: { volume?: number }): void {
  if (!enabled || !isSoundName(sound)) return;
  if (!userHasBeenActive()) {
    if (audioContextCtor()) armUnlock();
    return;
  }

  const playVolume = globalVolume * normalizeVolume(options?.volume, 1);
  if (playVolume === 0) return;

  const context = getAudioContext();
  if (!context) return;

  const recipe = RECIPES[sound];
  if (context.state === "running") {
    renderRecipe(context, recipe, playVolume);
  } else {
    const askedAt = now();
    tryResume(context, () => {
      if (!enabled || context.state !== "running") return;
      if (now() - askedAt > STALE_CUE_MS) return;
      renderRecipe(context, recipe, playVolume);
    });
    armUnlock();
  }
}

/**
 * Creates and starts the shared `AudioContext` without playing anything.
 * Call it from a gesture handler (`click`, `touchend`, `keydown`,
 * `mousedown`) when the
 * first cue of a visit will come from somewhere the browser does not treat
 * as a gesture: a drag library's pointer callbacks, a frame callback, the
 * continuation after an `await`. Behind the same gates as `play()`: a no-op
 * while disabled and without Web Audio; before the first user activation
 * it waits for the next gesture that counts and starts the context there.
 */
export function prime(): void {
  if (!enabled) return;
  if (!userHasBeenActive()) {
    if (audioContextCtor()) armUnlock();
    return;
  }
  const context = getAudioContext();
  if (!context || context.state === "running") return;
  tryResume(context, () => {});
  armUnlock();
}

function userHasBeenActive(): boolean {
  return typeof navigator === "undefined" || navigator.userActivation?.hasBeenActive !== false;
}
