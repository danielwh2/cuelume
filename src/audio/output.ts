/**
 * The shared output stage: one boosted bus through a subsonic cut and a
 * limiter, plus one faint stereo room every cue rings into. Built once per
 * AudioContext; also owns the shared noise buffer noise layers loop from.
 */

import { FLAT_Q } from "../sounds/layers.js";

export const OUTPUT_GAIN = 4;
/** Below this nothing is heard, but deep notes would still spend the limiter's headroom on it. */
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

export function getNoise(context: AudioContext, bus: OutputBus): AudioBuffer {
  if (bus.noise) return bus.noise;
  const length = Math.max(1, Math.floor(NOISE_SECONDS * context.sampleRate));
  bus.noise = context.createBuffer(1, length, context.sampleRate);
  const data = bus.noise.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = 2 * Math.random() - 1;
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

/** Builds one context's output bus and room. Engine owns the result and builds it once. */
export function createOutput(context: AudioContext): OutputBus {
  const output = context.createGain();
  output.gain.value = OUTPUT_GAIN;

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;

  const subsonic = context.createBiquadFilter();
  subsonic.type = "highpass";
  subsonic.frequency.value = SUBSONIC_HZ;
  subsonic.Q.value = FLAT_Q;

  output.connect(subsonic).connect(limiter).connect(context.destination);
  return { output, room: buildRoom(context, output), noise: null, live: new Set() };
}
