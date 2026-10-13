/**
 * The shared output stage: one boosted bus through a subsonic cut and a
 * soft clip, plus one faint stereo room every cue rings into. Built once per
 * AudioContext; also owns the shared noise buffer noise layers loop from.
 */

import { FLAT_Q } from "../sounds/layers.js";

export const OUTPUT_GAIN = 5.8;
export const CLIP_KNEE = 0.7;
const CLIP_CURVE_POINTS = 1025;
/** Below this nothing is heard, but deep notes would still spend headroom on it. */
export const SUBSONIC_HZ = 40;

/** Seconds of shared noise. Noise layers loop it from a random point, so none is made per play. */
export const NOISE_SECONDS = 2;

/** One context's output bus, room send target, cached noise buffer, and the voices sounding on it. Owned by engine.ts. */
export type OutputBus = { output: GainNode; room: AudioNode; noise: AudioBuffer | null; live: Set<GainNode> };

/** How long a silenced voice takes to fade: short enough to hear as at once, long enough not to click. */
const SILENCE_FADE = 0.015;

/**
 * Fades every voice sounding on `bus`, for a mute that should be heard at once.
 * ponytail: the room's own tail, a quarter of a second and 22 dB down, rings out; gate its return if that is ever heard
 */
export function silence(context: AudioContext, bus: OutputBus): void {
  const now = context.currentTime;
  for (const { gain } of bus.live) {
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + SILENCE_FADE);
  }
  bus.live.clear();
}

const NOISE_SEED = 1;

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

export function fillNoise(data: Float32Array): void {
  const random = seeded(NOISE_SEED);
  for (let i = 0; i < data.length; i++) data[i] = 2 * random() - 1;
}

export function getNoise(context: AudioContext, bus: OutputBus): AudioBuffer {
  if (bus.noise) return bus.noise;
  const length = Math.max(1, Math.floor(NOISE_SECONDS * context.sampleRate));
  bus.noise = context.createBuffer(1, length, context.sampleRate);
  fillNoise(bus.noise.getChannelData(0));
  return bus.noise;
}

/**
 * The shared room: a short, dense burst of reflections that dies away over
 * ROOM_SECONDS. Reflections within the first 80 ms or so are what move a sound
 * out of the listener's head (Begault); a longer tail only adds distance. Its
 * two channels are independent noise, so the room is wide while the sound
 * itself stays centred.
 */
export const ROOM_SECONDS = 0.25;
/** The gap before the first reflection: a small room's nearest wall. */
export const ROOM_PREDELAY = 0.008;
/** Reflections are low-passed here: walls swallow the highs first. */
export const ROOM_LOWPASS = 3500;
/** How much of every cue reaches the room: about 22 dB down, faint enough to feel rather than hear. */
export const ROOM_SEND = 0.08;
/** 60 dB of decay, the conventional end of a room's tail. */
export const ROOM_DECAY_DB = 60;

export const ROOM_SEEDS = [3110, 5639] as const;
const ROOM_REFLECTIONS_PER_SECOND = 48000;

export function fillRoom(data: Float32Array, rate: number, seed: number): void {
  const random = seeded(seed);
  const fall = (ROOM_DECAY_DB / 20) * Math.LN10;
  const reflections = new Float32Array(Math.floor(ROOM_SECONDS * ROOM_REFLECTIONS_PER_SECOND));
  let energy = 0;
  for (let i = 0; i < reflections.length; i++) {
    const t = i / ROOM_REFLECTIONS_PER_SECOND;
    reflections[i] = t < ROOM_PREDELAY ? 0 : (2 * random() - 1) * Math.exp((-fall * t) / ROOM_SECONDS);
    energy += reflections[i] * reflections[i];
  }
  const scale = 1 / Math.sqrt(energy);
  for (let i = 0; i < reflections.length; i++) {
    const at = (i / ROOM_REFLECTIONS_PER_SECOND) * rate;
    const sample = Math.floor(at);
    const late = at - sample;
    if (sample < data.length) data[sample] += reflections[i] * scale * (1 - late);
    if (sample + 1 < data.length) data[sample + 1] += reflections[i] * scale * late;
  }
}

/** Builds the room once, feeding `output`; returns the node sends connect to. */
function buildRoom(context: AudioContext, output: AudioNode): AudioNode {
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(ROOM_SECONDS * rate));
  const impulse = context.createBuffer(2, length, rate);
  ROOM_SEEDS.forEach((seed, channel) => fillRoom(impulse.getChannelData(channel), rate, seed));
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

function softClip(level: number): number {
  const over = Math.abs(level) - CLIP_KNEE;
  if (over <= 0) return level;
  const shoulder = 1 - CLIP_KNEE;
  return Math.sign(level) * (CLIP_KNEE + over - (over * over) / (2 * shoulder));
}

/** Builds one context's output bus and room. Engine owns the result and builds it once. */
export function createOutput(context: AudioContext): OutputBus {
  const output = context.createGain();
  output.gain.value = OUTPUT_GAIN;

  const clip = context.createWaveShaper();
  clip.curve = Float32Array.from({ length: CLIP_CURVE_POINTS }, (_, i) => softClip((2 * i) / (CLIP_CURVE_POINTS - 1) - 1));

  const subsonic = context.createBiquadFilter();
  subsonic.type = "highpass";
  subsonic.frequency.value = SUBSONIC_HZ;
  subsonic.Q.value = FLAT_Q;

  output.connect(subsonic).connect(clip).connect(context.destination);
  return { output, room: buildRoom(context, output), noise: null, live: new Set() };
}
