/**
 * The `mech` theme: the same fourteen cues in a dry, precise, mechanical
 * material. Machined parts rather than glass, wood, and air. No room, no
 * ring beyond a struck part's own, and nothing harsh, industrial,
 * retro-computer, or sci-fi.
 *
 * Level-matched to the default palette on perceived loudness (K-weighted, the
 * loudest 100 ms), so switching themes changes the material, not the volume.
 *
 * Arranged for emphasis like the default palette: layers marked from
 * "normal" are ornament that subtle leaves out, and each cue has a layer only
 * strong plays.
 */

import { BAR, contact, knock, struck, type SoundRecipe } from "./layers.js";
import type { SoundName } from "./recipes.js";

export const MECH = {
  /** A machined click, like a camera's shutter button, over the short knock of its housing. */
  tap: {
    masterGain: 0.964,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 2650, filterQ: 1.5, attack: 0.001, decay: 0.00413, peak: 0.08 },
      knock(455, 0.0156, 0.02),
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 4600, filterQ: 2, attack: 0.001, decay: 0.00222, peak: 0.05 },
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 215, filterQ: 2, attack: 0.001, decay: 0.0216, peak: 0.3 },
    ],
    vary: { pitch: 0.02, level: 0.1 },
  },
  /** A tight low-profile switch: shorter and drier than a keycap, almost no body. */
  type: {
    masterGain: 0.484,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 3000, filterQ: 1.2, attack: 0.001, decay: 0.003, peak: 0.1 },
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 2150, filterQ: 5, attack: 0.001, decay: 0.00737, peak: 0.18 },
      { kind: "noise", filterType: "bandpass", filterFrequency: 750, filterQ: 3, attack: 0.001, decay: 0.00898, peak: 0.22 },
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 330, filterQ: 2.5, attack: 0.001, decay: 0.0173, peak: 0.3 },
    ],
    vary: { pitch: 0.05, level: 0.15 },
  },
  /** A ratchet detent: a precision dial clicking over one tooth, with a faint ring of the metal. */
  select: {
    masterGain: 0.295,
    layers: [
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 3650, filterQ: 3, attack: 0.001, decay: 0.00273, peak: 0.2 },
      { kind: "noise", filterType: "bandpass", filterFrequency: 1500, filterQ: 8, attack: 0.001, decay: 0.00762, peak: 0.35 },
      { kind: "tone", waveform: "sine", frequency: 1480, attack: 0.001, decay: 0.0433, peak: 0.012 },
      knock(250, 0.0188, 0.025, { from: "strong" }),
    ],
  },
  /** A toggle switch's throw: the lever snaps over centre with the knock of its housing. */
  toggle: {
    masterGain: 0.293,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 1650, filterQ: 2, attack: 0.001, decay: 0.00381, peak: 0.14 },
      knock(330, 0.0288, 0.04),
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 2650, filterQ: 3, attack: 0.001, decay: 0.00553, peak: 0.18 },
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 250, filterQ: 2, attack: 0.001, decay: 0.0259, peak: 0.3 },
    ],
  },
  /** A latch releasing: the catch lets go as the bolt slides back, in one motion. */
  open: {
    masterGain: 0.869,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 2150, filterQ: 3, attack: 0.001, decay: 0.00375, peak: 0.16 },
      { kind: "noise", filterType: "bandpass", filterFrequency: 1160, glideTo: 2150, glideTime: 0.05, filterQ: 2, attack: 0.02, decay: 0.031, peak: 0.08 },
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 1330, filterQ: 5, attack: 0.001, decay: 0.00763, peak: 0.14 },
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 290, filterQ: 2, attack: 0.001, decay: 0.0265, peak: 0.25 },
    ],
  },
  /** A latch catching: the bolt slides home into the catch, in one motion. */
  close: {
    masterGain: 0.96,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 2150, glideTo: 1080, glideTime: 0.04, filterQ: 2, attack: 0.015, decay: 0.0288, peak: 0.04 },
      { kind: "noise", filterType: "bandpass", filterFrequency: 1000, filterQ: 4, attack: 0.001, decay: 0.00898, peak: 0.22 },
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 3300, filterQ: 2, attack: 0.001, decay: 0.003, peak: 0.1 },
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 180, filterQ: 2, attack: 0.001, decay: 0.0302, peak: 0.3 },
    ],
  },
  /** One dry struck bar, F, C and A at once, spread so no two notes rub, hit with something hard: a short chord, not a bell. */
  success: {
    masterGain: 0.662,
    layers: [
      contact(2200, 0.05),
      ...struck(698.46, 0.121, 0.03, BAR),
      ...struck(1046.5, 0.149, 0.026, BAR),
      ...struck(1760, 0.106, 0.018, BAR),
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 4150, filterQ: 2, attack: 0.001, decay: 0.00324, peak: 0.06 },
    ],
  },
  /** One firm low knock with a dull D in it and the F a tenth above, like a handle that is locked. */
  error: {
    masterGain: 0.59,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 430, filterQ: 4, attack: 0.001, decay: 0.0173, peak: 0.3 },
      ...struck(293.66, 0.0678, 0.045, BAR),
      ...struck(698.46, 0.0522, 0.02, BAR),
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 1830, filterQ: 3, attack: 0.001, decay: 0.006, peak: 0.1 },
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 150, filterQ: 2, attack: 0.001, decay: 0.0345, peak: 0.3 },
    ],
  },
  /** A short carriage slide, rising as it passes. */
  navigate: {
    masterGain: 0.804,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 750, glideTo: 1400, glideTime: 0.13, filterQ: 1.8, attack: 0.05, decay: 0.096, peak: 0.1 },
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 2500, filterQ: 4, attack: 0.001, decay: 0.003, peak: 0.1 },
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 250, filterQ: 1.5, attack: 0.04, decay: 0.109, peak: 0.12 },
    ],
  },
  /** One dry struck fifth, D and A: between success and error. */
  warning: {
    masterGain: 0.484,
    layers: [
      contact(2000, 0.05),
      ...struck(587.33, 0.0922, 0.04, BAR),
      ...struck(880, 0.0969, 0.03, BAR),
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 300, filterQ: 2, attack: 0.001, decay: 0.0265, peak: 0.25 },
    ],
  },
  /** A small motor spinning up and winding down: one soft, low whirr over about a second. */
  loading: {
    masterGain: 0.223,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 500, filterQ: 1, attack: 0.35, decay: 0.848, peak: 0.03 },
      { kind: "tone", waveform: "sine", frequency: 233.08, attack: 0.35, decay: 0.965, peak: 0.015 },
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 1000, filterQ: 2, attack: 0.35, decay: 0.883, peak: 0.005 },
      { from: "strong", kind: "noise", filterType: "lowpass", filterFrequency: 250, filterQ: 0.7, attack: 0.35, decay: 0.807, peak: 0.04 },
    ],
  },
  /** One dry struck bar, lower than success: a result is there. */
  ready: {
    masterGain: 0.546,
    layers: [
      contact(2000, 0.05),
      ...struck(523.25, 0.178, 0.05, BAR),
      ...struck(261.63, 0.242, 0.03, BAR, { from: "strong" }),
    ],
  },
  /** One metal bell, A and E struck together, ringing longer than the rest. */
  attention: {
    masterGain: 0.481,
    layers: [
      contact(2500, 0.04),
      ...struck(880, 0.231, 0.04, BAR),
      ...struck(1318.51, 0.242, 0.03, BAR),
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 300, filterQ: 2, attack: 0.001, decay: 0.0265, peak: 0.25 },
    ],
  },
  /** An odometer drum turning: one dry slide that rises with the count and lasts as long as the roll. */
  count: {
    masterGain: 0.654,
    layers: [
      { stretch: true, kind: "noise", filterType: "bandpass", filterFrequency: 500, glideTo: 900, glideTime: 0.6, filterQ: 2, attack: 0.1, decay: 0.648, peak: 0.06 },
      { stretch: true, from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 1900, glideTo: 3300, glideTime: 0.6, filterQ: 4, attack: 0.1, decay: 0.606, peak: 0.03 },
      { stretch: true, from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 220, filterQ: 2, attack: 0.1, decay: 0.5, peak: 0.1 },
    ],
    vary: { pitch: 0.03, level: 0.1 },
  },
} satisfies Record<SoundName, SoundRecipe>;
