/**
 * The `press` theme: the same fourteen cues, each one press of a premium
 * switch, built from the Subscribe press and keycaps in DawoodUI's Artasaka
 * preview. A press clicks at 4 kHz over a deep note that swells in and rings
 * for about a second; it lets go with a lighter click at 4.8 kHz, 5 dB down.
 * Quick taps walk up a chord, C, E, A, as the video's presses do.
 *
 * Keys are the video's keycaps: one lands with a click over a body that drops
 * 480 to 305 Hz, and lifts off with a quieter click over 676 to 414 Hz.
 *
 * Outcomes are not touched, so they do not click: they are the press's note
 * on its own, with a chord that says what happened. Success is major and
 * rings into a small room, error a low, spread minor over a soft thump,
 * warning a plain fifth between them, attention a high bell ringing longest,
 * and loading one soft, low note that swells in and fades.
 *
 * Arranged for emphasis like the other themes: layers marked from "normal"
 * are ornament that subtle leaves out (a note's upper partials, the release),
 * and each cue has a layer only strong plays.
 */

import { air, click, knock, LANDED, note, ring, thud, type SoundRecipe } from "./layers.js";
import type { SoundName } from "./recipes.js";

const C2 = 65.41, E2 = 82.41, A2 = 110;
const G3 = 196, A3 = 220;
const C4 = 261.63, E4 = 329.63, G4 = 392, A4 = 440;
const C5 = 523.25, E5 = 659.25, A5 = 880;

/** The video's presses: the press rings at 4 kHz, the release at 4.8 kHz. */
const PRESS_HZ = 4000;
const RELEASE_HZ = 4800;
/** The video's walk: C, E and A over its first note. */
const WALK = [0, 4, 9];
/** A note that rings as the video's does: about 45 dB a second. */
const RING = 1.4;

const STEADY = { pitch: 0, level: 0.08 };

export const PRESS = {
  /** The Subscribe press: a click over a deep C that swells in and rings, and a lighter click letting go. Quick taps walk C, E, A. */
  tap: {
    masterGain: 0.0431,
    layers: [...click(PRESS_HZ, 0.53), ...note(C2, RING, 0.12), thud(200, 0.05, 0.15, { from: "strong" })],
    release: click(RELEASE_HZ, 0.28, { from: "normal" }),
    walk: WALK,
    vary: STEADY,
  },
  /** A keycap landing, and lifting off quieter as the key comes up. Every stroke a slightly different key. */
  type: {
    masterGain: 0.297,
    layers: [...click(4200, 0.25), knock(305, 0.025, 0.04), knock(150, 0.035, 0.03, { from: "strong" })],
    release: [ring(4100, 0.08, { from: "normal" }), ring(1000, 0.06, { filterQ: 2, from: "normal" }), knock(414, 0.015, 0.012, { from: "normal" })],
    vary: { pitch: 0.08, level: 0.15 },
  },
  /** A detent: only the light click, over a small, high knock. A later option knocks higher, an earlier one lower. */
  select: {
    masterGain: 0.442,
    layers: [...click(RELEASE_HZ, 0.12), knock(700, 0.015, 0.02), knock(350, 0.025, 0.02, { from: "strong" })],
    release: [ring(RELEASE_HZ, 0.03, { from: "normal" })],
    vary: { pitch: 0.02, level: 0.1 },
  },
  /** A switch thrown: the press and a firm knock over a short, deep E, letting go lighter. Switching off knocks upward. */
  toggle: {
    masterGain: 0.0571,
    layers: [...click(PRESS_HZ, 0.245), knock(330, 0.035, 0.05), ...note(E2, 0.3, 0.06), knock(165, 0.045, 0.05, { from: "strong" })],
    release: click(RELEASE_HZ, 0.1, { from: "normal" }),
    vary: STEADY,
  },
  /** A lid lifting: the light click, a knock, air drawn upward and an A swelling in under it. Quick opens walk. */
  open: {
    masterGain: 0.0857,
    layers: [
      ...click(RELEASE_HZ, 0.15),
      knock(440, 0.03, 0.03),
      air(1600, 3200, 0.035, 0.1),
      ...note(A2, 0.8, 0.08),
      thud(260, 0.04, 0.12, { from: "strong" }),
    ],
    release: [ring(RELEASE_HZ, 0.05, { from: "normal" })],
    walk: WALK,
    vary: STEADY,
  },
  /** A lid shutting: a lower, duller click, air pushed out and down, and a low C, damped short, as it seats. */
  close: {
    masterGain: 0.099,
    layers: [
      ...click(3200, 0.204),
      knock(130.81, 0.04, 0.06),
      air(1800, 700, 0.04, 0.1, { from: "normal" }),
      ...note(C2, 0.25, 0.08),
      thud(180, 0.04, 0.2, { from: "strong" }),
    ],
    vary: STEADY,
  },
  /** No click: C, G and E struck at once, swelling in and ringing long into a small room. */
  success: {
    masterGain: 0.102,
    layers: [...note(C4, RING, 0.072), ...note(G4, RING, 0.06), ...note(E5, 1.2, 0.045), ...note(C4 / 2, RING, 0.036, { from: "strong" })],
    room: LANDED,
  },
  /** No click: a low A with the C an octave and a third above, minor and spread, over a soft thump. A calm refusal. */
  error: {
    masterGain: 0.0708,
    layers: [
      ...note(A2, 0.5, 0.12),
      ...note(C5, 0.4, 0.04),
      thud(200, 0.06, 0.2, { attack: 0.01 }),
      thud(120, 0.08, 0.2, { from: "strong" }),
    ],
  },
  /** A swipe: the light click with air sliding past it. Going back, the air falls. */
  navigate: {
    masterGain: 0.837,
    layers: [
      ...click(RELEASE_HZ, 0.15),
      air(600, 1400, 0.09, 0.12, { filterQ: 1 }),
      knock(587.33, 0.015, 0.015, { from: "normal" }),
      thud(300, 0.05, 0.12, { from: "strong" }),
    ],
    vary: STEADY,
  },
  /** No click: a plain fifth, A and E, between success and error. Heads up, nothing broke. */
  warning: {
    masterGain: 0.0716,
    layers: [...note(A3, 0.9, 0.096), ...note(E4, 0.8, 0.072), ...note(A3 / 2, 0.9, 0.048, { from: "strong" })],
  },
  /** No click: one warm, low G that swells in softly and fades within about a second. Work has begun. */
  loading: {
    masterGain: 0.0661,
    layers: [
      { kind: "tone", waveform: "sine", frequency: G3, attack: 0.35, decay: 0.8, peak: 0.05 },
      { from: "normal", kind: "tone", waveform: "sine", frequency: G3 * 2, attack: 0.35, decay: 0.6, peak: 0.01 },
      { from: "strong", kind: "tone", waveform: "sine", frequency: G3 / 2, attack: 0.35, decay: 0.8, peak: 0.03 },
    ],
  },
  /** No click: one long, warm G below success, ringing into a small room. A result is there. */
  ready: {
    masterGain: 0.0983,
    layers: [...note(G3, 1.8, 0.108), ...note(G3 / 2, 1.8, 0.054, { from: "strong" })],
    room: LANDED,
  },
  /** No click: A and E over A, high and bell-like, ringing longest. Blocked until the user answers. */
  attention: {
    masterGain: 0.125,
    layers: [...note(A4, 2.2, 0.067), ...note(E5, 2, 0.048), ...note(A5, 1.5, 0.024), ...note(A4 / 2, 2.2, 0.034, { from: "strong" })],
  },
  /** A number rolling: a dial spun, air rising with it for as long as the roll (falling counting down). */
  count: {
    masterGain: 0.362,
    layers: [
      { stretch: true, kind: "noise", filterType: "bandpass", filterFrequency: 900, glideTo: 1800, glideTime: 0.6, filterQ: 2, attack: 0.15, decay: 0.55, peak: 0.08 },
      { stretch: true, kind: "noise", filterType: "lowpass", filterFrequency: 200, glideTo: 500, glideTime: 0.6, filterQ: 0.7, attack: 0.15, decay: 0.55, peak: 0.06 },
      { stretch: true, from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 2600, glideTo: 3600, glideTime: 0.6, filterQ: 4, attack: 0.15, decay: 0.45, peak: 0.02 },
      { stretch: true, from: "strong", kind: "noise", filterType: "lowpass", filterFrequency: 150, glideTo: 300, glideTime: 0.6, filterQ: 0.7, attack: 0.15, decay: 0.55, peak: 0.08 },
    ],
    vary: { pitch: 0.02, level: 0.1 },
  },
} satisfies Record<SoundName, SoundRecipe>;
