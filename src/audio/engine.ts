/**
 * The audio engine — synthesizes each sound live via the Web Audio API
 * on one shared, lazily created `AudioContext`. No audio files, no
 * dependencies. Every sound carries a gentle envelope, and the ones that
 * want air share one small synthesized room instead of a slapback delay,
 * so nothing feels harsh or echoey.
 */

import {
  RECIPES,
  isSoundName,
  type NoiseLayer,
  type SoundLayer,
  type SoundName,
  type SoundRecipe,
  type ToneLayer,
} from "../sounds/recipes.js";

const SOURCE_STOP_PADDING = 0.05;
const CLEANUP_MARGIN = 0.05;
const OUTPUT_GAIN = 4;
/** Length of the shared room's impulse response, in seconds. */
const SPACE_SECONDS = 0.5;

function renderEnvelope(context: AudioContext, layer: SoundLayer, startTime: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(layer.peak, startTime + layer.attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + layer.attack + layer.decay);
  return gain;
}

function connectLayer(
  context: AudioContext,
  gain: GainNode,
  destination: AudioNode,
  layer: SoundLayer,
): void {
  if (!layer.pan) {
    gain.connect(destination);
    return;
  }
  const panner = context.createStereoPanner();
  panner.pan.value = layer.pan;
  gain.connect(panner).connect(destination);
}

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

  const gain = renderEnvelope(context, layer, startTime);
  oscillator.connect(gain);
  connectLayer(context, gain, destination, layer);
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

  const gain = renderEnvelope(context, layer, startTime);
  source.connect(filter).connect(gain);
  connectLayer(context, gain, destination, layer);
  source.start(startTime);
  source.stop(startTime + duration);
}

/**
 * Builds the impulse response of a small, dark room: decorrelated noise in
 * each channel, decaying exponentially, with the highs damped more as the
 * tail runs out — like the short room tone behind a system sound.
 */
function createSpaceImpulse(context: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(SPACE_SECONDS * context.sampleRate));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let lowpassed = 0;
    for (let i = 0; i < length; i++) {
      const progress = i / length;
      const damping = 0.4 - 0.3 * progress;
      lowpassed += (2 * Math.random() - 1 - lowpassed) * damping;
      data[i] = lowpassed * Math.exp(-progress * 8);
    }
  }
  return buffer;
}

function sourceEnd(recipe: SoundRecipe): number {
  return Math.max(
    ...recipe.layers.map(
      (layer) => (layer.offset ?? 0) + layer.attack + layer.decay + SOURCE_STOP_PADDING,
    ),
  );
}

type Bus = { output: GainNode; space: ConvolverNode };

let sharedBus: Bus | null = null;

function getBus(context: AudioContext): Bus {
  if (sharedBus) return sharedBus;

  const output = context.createGain();
  output.gain.value = OUTPUT_GAIN;

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;

  output.connect(limiter).connect(context.destination);

  const space = context.createConvolver();
  space.buffer = createSpaceImpulse(context);
  space.connect(output);

  sharedBus = { output, space };
  return sharedBus;
}

function renderRecipe(context: AudioContext, recipe: SoundRecipe, volume: number): void {
  const now = context.currentTime;
  const { output, space } = getBus(context);
  const master = context.createGain();
  master.gain.value = recipe.masterGain * volume;
  master.connect(output);

  let send: GainNode | null = null;
  if (recipe.space) {
    send = context.createGain();
    send.gain.value = recipe.space;
    master.connect(send).connect(space);
  }

  for (const layer of recipe.layers) {
    const startTime = now + (layer.offset ?? 0);
    if (layer.kind === "tone") renderTone(context, master, layer, startTime);
    else renderNoise(context, master, layer, startTime);
  }

  const tail = send ? SPACE_SECONDS : 0;
  const cleanupAfterMs = (sourceEnd(recipe) + tail + CLEANUP_MARGIN) * 1000;
  setTimeout(() => {
    master.disconnect();
    send?.disconnect();
  }, cleanupAfterMs);
}

let sharedContext: AudioContext | null = null;
let enabled = true;
let globalVolume = 1;

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

/**
 * Plays a sound immediately. Safe to call from anywhere — lazily creates
 * the shared `AudioContext` on first use, resumes it if the browser
 * started it suspended (e.g. before any user gesture), and is a no-op
 * when Web Audio is unavailable (SSR, old browsers).
 */
export function play(sound: SoundName = "chime", options?: { volume?: number }): void {
  if (!enabled || !isSoundName(sound)) return;
  if (typeof navigator !== "undefined" && navigator.userActivation?.hasBeenActive === false) return;

  const playVolume = globalVolume * normalizeVolume(options?.volume, 1);
  if (playVolume === 0) return;

  const context = getAudioContext();
  if (!context) return;

  const recipe = RECIPES[sound];
  if (context.state === "running") {
    renderRecipe(context, recipe, playVolume);
  } else {
    try {
      void context.resume().then(
        () => {
          if (enabled && context.state === "running") renderRecipe(context, recipe, playVolume);
        },
        () => {},
      );
    } catch {
      // Some browsers throw synchronously when audio is blocked.
    }
  }
}
