/**
 * The `bubble` theme: the same fourteen cues, made of water. Playful and
 * opt-in: an app switches to it with `setTheme`, or uses it for one moment with
 * `play()`'s `theme` option or `data-cuelume-theme`.
 *
 * Every cue is its own gesture, and one sound: a knock for tap and type, a drip
 * for select, a cork for toggle, a balloon for open, a gulp for close, and so
 * on. The only theme whose tones slide. Nothing
 * is centred above 5 kHz, outcomes say what they mean in one glide (success rises,
 * error sinks, warning stays level, attention bends up), and levels match the
 * default palette on perceived loudness (K-weighted, the loudest 100 ms).
 *
 * Arranged for emphasis like the other themes: layers marked from "normal"
 * are ornament that subtle leaves out, and each cue has a layer only strong
 * plays.
 */

import { knock, LANDED, type NoiseLayer, type SoundRecipe, type ToneLayer } from "./layers.js";
import type { SoundName } from "./recipes.js";

/** A sine that slides from `from` to `to` Hz in `time` seconds. */
const slide = (from: number, to: number, time: number, decay: number, peak: number, more: Partial<ToneLayer> = {}): ToneLayer => ({
  kind: "tone", waveform: "sine", frequency: from, glideTo: to, glideTime: time, attack: 0.002, decay, peak, ...more,
});

/** A bubble surfacing: a sine that rises by half in 40 ms. */
const bloop = (frequency: number, decay: number, peak: number, more: Partial<ToneLayer> = {}): ToneLayer =>
  slide(frequency, frequency * 1.5, 0.04, decay, peak, more);

/** A drop falling from a tap: a quick flick upward, done in 12 ms. */
const drip = (frequency: number, decay: number, peak: number, more: Partial<ToneLayer> = {}): ToneLayer =>
  slide(frequency, frequency * 1.5, 0.012, decay, peak, { attack: 0.001, ...more });

/** A struck note that settles a third down onto its pitch, like a kalimba tine. */
const pluck = (frequency: number, decay: number, peak: number, more: Partial<ToneLayer> = {}): ToneLayer =>
  slide(frequency * 1.3, frequency, 0.012, decay, peak, { attack: 0.001, ...more });

/** A bubble bursting: 3 ms of low-passed noise. */
const pop = (filterFrequency: number, peak: number, more: Partial<NoiseLayer> = {}): NoiseLayer => ({
  kind: "noise", filterType: "lowpass", filterFrequency, filterQ: 0.9, attack: 0.001, decay: 0.003, peak, ...more,
});

/** Input and surface cues: no two plays match. */
const LIVELY = { pitch: 0.06, level: 0.1 };
/** Outcome and progress cues vary in level only, so a rise stays a rise and a level note stays level. */
const STEADY = { pitch: 0, level: 0.08 };

export const BUBBLE = {
  /** A keycap landing on water: a soft knock that blooms into a small bubble. A little different every time. */
  tap: {
    masterGain: 0.411,
    layers: [
      knock(300, 0.02, 0.06),
      bloop(600, 0.035, 0.014, { attack: 0.012 }),
      knock(600, 0.012, 0.015, { from: "normal" }),
      knock(150, 0.035, 0.05, { from: "strong" }),
    ],
    vary: { pitch: 0.08, level: 0.1 },
  },
  /** A keycap popping up: a higher, shorter knock, pitched differently every stroke. */
  type: {
    masterGain: 0.383,
    layers: [
      knock(415, 0.014, 0.06),
      pop(2500, 0.03, { from: "normal" }),
      knock(208, 0.025, 0.05, { from: "strong" }),
    ],
    vary: { pitch: 0.1, level: 0.2 },
  },
  /** A drip: the only quick flick upward. A later option drips higher, an earlier one lower. */
  select: {
    masterGain: 0.214,
    layers: [
      drip(700, 0.025, 0.05),
      pop(3000, 0.075, { from: "normal" }),
      bloop(350, 0.05, 0.03, { from: "strong" }),
    ],
    vary: { pitch: 0.03, level: 0.1 },
  },
  /** A cork: a soft thup as the air rushes up an octave. Switching off sinks it. */
  toggle: {
    masterGain: 0.175,
    layers: [
      { kind: "noise", filterType: "lowpass", filterFrequency: 900, filterQ: 0.9, attack: 0.001, decay: 0.008, peak: 0.12 },
      slide(330, 660, 0.06, 0.07, 0.045, { attack: 0.003 }),
      slide(990, 1485, 0.02, 0.03, 0.01, { from: "normal", attack: 0.03 }),
      slide(165, 330, 0.06, 0.08, 0.03, { from: "strong" }),
    ],
    vary: { pitch: 0.04, level: 0.1 },
  },
  /** A balloon filling: one slow swell that rises a ninth. */
  open: {
    masterGain: 0.221,
    layers: [
      slide(220, 520, 0.14, 0.06, 0.04, { attack: 0.1 }),
      slide(330, 780, 0.14, 0.06, 0.012, { from: "normal", attack: 0.1 }),
      slide(110, 260, 0.14, 0.08, 0.03, { from: "strong", attack: 0.1 }),
    ],
    vary: LIVELY,
  },
  /** A gulp: one fast fall. */
  close: {
    masterGain: 0.357,
    layers: [
      slide(700, 220, 0.07, 0.08, 0.045, { attack: 0.004 }),
      pop(1200, 0.06, { from: "normal" }),
      slide(350, 110, 0.07, 0.1, 0.03, { from: "strong", attack: 0.004 }),
    ],
    vary: LIVELY,
  },
  /** One bubble rising a fifth, C to G, in a small room. */
  success: {
    masterGain: 0.52,
    layers: [
      slide(523.25, 783.99, 0.08, 0.28, 0.04, { attack: 0.003 }),
      slide(1046.5, 1567.98, 0.08, 0.08, 0.01, { from: "normal", attack: 0.003 }),
      slide(261.63, 392, 0.08, 0.3, 0.02, { from: "strong", attack: 0.003 }),
    ],
    room: LANDED,
    vary: STEADY,
  },
  /** One bubble sinking a fourth, F to C: a soft "uh-oh". */
  error: {
    masterGain: 0.387,
    layers: [
      slide(349.23, 261.63, 0.14, 0.2, 0.045, { attack: 0.004 }),
      pop(900, 0.12, { from: "normal" }),
      knock(147, 0.05, 0.05, { from: "strong" }),
    ],
    vary: STEADY,
  },
  /** A zip: one bubble shooting up through fizz. Going back, it dives. */
  navigate: {
    masterGain: 0.554,
    layers: [
      slide(300, 1500, 0.09, 0.08, 0.035, { attack: 0.01 }),
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 1500, glideTo: 3000, glideTime: 0.09, filterQ: 1, attack: 0.02, decay: 0.07, peak: 0.05 },
      slide(150, 600, 0.1, 0.1, 0.025, { from: "strong", attack: 0.01 }),
    ],
    vary: LIVELY,
  },
  /** One round note with a small wobble, settling where it started: level. */
  warning: {
    masterGain: 0.436,
    layers: [
      slide(500, 440, 0.05, 0.16, 0.045),
      pop(1800, 0.09, { from: "normal" }),
      { from: "strong", kind: "tone", waveform: "sine", frequency: 220, attack: 0.003, decay: 0.18, peak: 0.025 },
    ],
    vary: STEADY,
  },
  /** A simmer: one slow bubble rising through soft fizz, gone within about a second. Nothing lands. */
  loading: {
    masterGain: 0.194,
    layers: [
      { kind: "noise", filterType: "lowpass", filterFrequency: 900, filterQ: 0.7, attack: 0.35, decay: 0.6, peak: 0.03 },
      slide(400, 600, 0.35, 0.7, 0.016, { attack: 0.35 }),
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 1800, filterQ: 1.5, attack: 0.35, decay: 0.4, peak: 0.004 },
      { from: "strong", kind: "noise", filterType: "lowpass", filterFrequency: 400, filterQ: 0.7, attack: 0.35, decay: 0.7, peak: 0.04 },
    ],
    vary: STEADY,
  },
  /** A drop into water: the plip and the round bubble it leaves, one sound, in a small room. */
  ready: {
    masterGain: 0.532,
    layers: [
      slide(1400, 700, 0.012, 0.02, 0.03, { attack: 0.001 }),
      slide(392, 587.33, 0.06, 0.25, 0.04, { attack: 0.012 }),
      pop(2000, 0.03, { from: "normal" }),
      slide(196, 294, 0.08, 0.3, 0.02, { from: "strong", attack: 0.012 }),
    ],
    room: LANDED,
    vary: STEADY,
  },
  /** "Hm?": one note that bends up a fourth like a question. */
  attention: {
    masterGain: 0.666,
    layers: [
      slide(659.25, 880, 0.14, 0.25, 0.035, { attack: 0.003 }),
      pop(2200, 0.12, { from: "normal" }),
      bloop(329.63, 0.2, 0.02, { from: "strong" }),
    ],
    vary: STEADY,
  },
  /** A number rolling: fizz and one bubble rising together for as long as the roll (sinking counting down). */
  count: {
    masterGain: 0.267,
    layers: [
      { stretch: true, kind: "noise", filterType: "lowpass", filterFrequency: 900, glideTo: 1800, glideTime: 0.6, filterQ: 0.7, attack: 0.15, decay: 0.55, peak: 0.04 },
      { ...slide(587.33, 880, 0.6, 0.55, 0.02, { attack: 0.15 }), stretch: true },
      pop(1600, 0.05, { from: "normal" }),
      { ...slide(293.66, 440, 0.6, 0.55, 0.02, { attack: 0.15, from: "strong" }), stretch: true },
    ],
    vary: LIVELY,
  },
} satisfies Record<SoundName, SoundRecipe>;
