/**
 * Rendering: turns one shaped recipe into Web Audio nodes — an oscillator
 * or filtered-noise source per layer, each swelling in along a straight line
 * and dying away exponentially. Every sound rings faintly into the shared
 * room (see output.ts), so it sounds placed in a space.
 *
 * A straight swell is heard from its first moment; an exponential one stays
 * silent for most of its length and then jumps in, heard as a late second hit.
 */

import { arrangement, layerFactors, type Emphasis, type Shape } from "../sounds/context.js";
import type { NoiseLayer, SoundLayer, SoundRecipe, ToneLayer, Variation } from "../sounds/layers.js";
import type { SoundName } from "../sounds/recipes.js";
import { getNoise, NOISE_SECONDS, ROOM_SEND, type OutputBus } from "./output.js";

export const SOURCE_STOP_PADDING = 0.05;
const DECAY_DB = 60;
export const fallTime = (decay: number) => decay / ((DECAY_DB / 20) * Math.LN10);
const CLEANUP_MARGIN = 0.05;

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
  param.setTargetAtTime(0, startTime + layer.attack, fallTime(layer.decay));
}

function renderTone(
  context: AudioContext,
  destination: AudioNode,
  layer: ToneLayer,
  startTime: number,
): void {
  const oscillator = context.createOscillator();
  oscillator.type = layer.waveform;
  glide(oscillator.frequency, layer.frequency, layer, startTime);
  if (layer.detune) oscillator.detune.value = layer.detune;

  const gain = context.createGain();
  envelope(gain.gain, layer, startTime);

  oscillator.connect(gain).connect(destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + layer.attack + layer.decay + SOURCE_STOP_PADDING);
}

function renderNoise(
  context: AudioContext,
  bus: OutputBus,
  destination: AudioNode,
  layer: NoiseLayer,
  startTime: number,
): void {
  const duration = layer.attack + layer.decay + SOURCE_STOP_PADDING;
  const source = context.createBufferSource();
  source.buffer = getNoise(context, bus);
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
}

function sourceEnd(layers: SoundLayer[]): number {
  return Math.max(
    ...layers.map(
      (layer) => (layer.offset ?? 0) + layer.attack + layer.decay + SOURCE_STOP_PADDING,
    ),
  );
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
const HANDOFF_TIME = 0.08;
/**
 * A cue with notes lets its last play go slower, so a walk overlaps: in the
 * Artasaka press the old note falls about twice as fast once the next lands.
 */
const NOTE_HANDOFF_TIME = 0.4;
/**
 * Each cue's latest voice and how fast it lets go. A cue plays one voice at a
 * time, like one key under one finger: playing it again releases the last play
 * instead of stacking on it. Other cues ring on. Owned by engine.ts.
 */
export type Voices = Map<SoundName, { gain: GainNode; fade: number }>;

/** The Artasaka press lets go 85–95 ms after it presses; a play with no real let-go waits this long. */
export const RELEASE_GAP = 0.09;

/**
 * Which part of a gesture to play: the press, the release as it lets go, or
 * both, the release RELEASE_GAP later.
 */
export type Part = "press" | "release" | "both";

/** Everything one press decided, so its release sounds like the same press. */
export type Played = { recipe: SoundRecipe; volume: number; emphasis: Emphasis; shape: Shape; step: number };

/**
 * A copy of `layer` bent by the play's context shape and its strike. A cue
 * with `vary` also moves each layer's ring and tone a little on its own, so no
 * two plays match; one without plays exactly. A harder strike raises a noise
 * layer's filter with its level: louder is brighter. A reversed sweep starts
 * where it would have ended. `time` moves every layer's start, and a
 * `stretch` layer lasts as long as the count.
 */
function shaped(layer: SoundLayer, shape: Shape, strike: Strike, vary: Variation | undefined, walk: number): SoundLayer {
  const factors = layerFactors(layer, shape);
  const tune = layer.kind === "tone" ? (vary ? nudge(MODE_JITTER) : 1) : strike.force;
  const pitch = factors.pitch * strike.pitch * tune * (layer.note ? walk : 1);
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

/**
 * The layers `part` of one play sounds: arranged for its emphasis, bent by its
 * shape, strike and walk, the release starting as the gesture lets go. No Web
 * Audio here, so scripts/sound.mjs renders the same layers offline.
 */
export function layersFor({ recipe, emphasis, shape, step }: Pick<Played, "recipe" | "emphasis" | "shape" | "step">, part: Part): SoundLayer[] {
  const parts: [layers: SoundLayer[], delay: number][] = [];
  if (part !== "release") parts.push([recipe.layers, 0]);
  if (part !== "press" && recipe.release) parts.push([recipe.release, part === "both" ? RELEASE_GAP : 0]);
  const walk = 2 ** ((recipe.walk?.[step] ?? 0) / 12);
  const { vary } = recipe;
  const strike = vary ? { pitch: nudge(vary.pitch), force: nudge(vary.level) } : STEADY_STRIKE;
  return parts.flatMap(([partLayers, delay]) =>
    arrangement(partLayers, emphasis).map((layer) => {
      const bent = shaped(layer, shape, strike, vary, walk);
      return { ...bent, offset: (bent.offset ?? 0) + delay };
    }),
  );
}

export function renderRecipe(context: AudioContext, getBus: () => OutputBus, voices: Voices, sound: SoundName, played: Played, part: Part): void {
  const { recipe, volume } = played;
  const layers = layersFor(played, part);
  if (layers.length === 0) return;

  const now = context.currentTime;
  const bus = getBus();
  const { output, room } = bus;
  const master = context.createGain();
  master.gain.value = recipe.masterGain * volume;
  master.connect(output);
  const send = context.createGain();
  send.gain.value = ROOM_SEND * (recipe.room ?? 1);
  master.connect(send).connect(room);
  bus.live.add(master);

  // a release rings with its press rather than replacing it
  if (part !== "release") {
    const last = voices.get(sound);
    if (last) {
      last.gain.gain.setValueAtTime(last.gain.gain.value, now);
      last.gain.gain.exponentialRampToValueAtTime(0.0001, now + last.fade);
    }
    const fade = recipe.layers.some((layer) => layer.note) ? NOTE_HANDOFF_TIME : HANDOFF_TIME;
    voices.set(sound, { gain: master, fade });
  }

  for (const layer of layers) {
    const startTime = now + (layer.offset ?? 0);
    if (layer.kind === "tone") renderTone(context, master, layer, startTime);
    else renderNoise(context, bus, master, layer, startTime);
  }

  // the room rings on by itself once the last source has fed it
  const cleanupAfterMs = (sourceEnd(layers) + CLEANUP_MARGIN) * 1000;
  setTimeout(() => {
    if (voices.get(sound)?.gain === master) voices.delete(sound);
    bus.live.delete(master);
    master.disconnect();
    send.disconnect();
  }, cleanupAfterMs);
}
