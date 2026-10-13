/**
 * The sound palette — the fourteen canonical cues, built from layers.ts.
 * Each cue names an interface job, not a synthesis style, and has its own
 * distinct shape rather than being a volume/EQ tweak on the same click.
 * Retired v0.2 names live on as aliases until 1.0.
 */

import { BAR, LANDED, MALLET, contact, knock, struck, type SoundRecipe } from "./layers.js";

// Each cue is arranged for three emphases: layers marked from "normal" are
// ornament that subtle leaves out, and each cue has one layer of its own that
// only strong plays.
//
// A cue's press strikes at once, and so does its release: no layer starts late.
//
// Premium, not playful: clicks and knocks are filtered noise, tones are
// struck objects (`struck`): a marimba bar for mallets, a free bar for glass,
// each mode dying faster the higher it is, touched off by the mallet's
// `contact`. Chords are spread so no two notes rub. Rooms are short enough
// to hear as space rather than echo, and no audible tone slides in pitch: a
// knock's 18 ms drop is heard as the body of a tap, not as a slide.
// Nothing is centred above 5 kHz, so the palette holds up through a working day.
export const RECIPES = {
  /**
   * A small glassy tap — buttons, links, nav. A nail's tick, a soft knock of
   * body, then the glass ringing briefly: the fundamental is two near-identical modes that beat
   * slowly, as real glass shimmers, and the upper mode sits at the glass-bar
   * ratio 2.76x, dying faster than the fundamental.
   */
  tap: {
    masterGain: 0.39,
    layers: [
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 4500, filterQ: 1.2, attack: 0.001, decay: 0.00242, peak: 0.03 },
      { kind: "tone", waveform: "sine", frequency: 1174.66, attack: 0.001, decay: 0.18, peak: 0.0135 },
      { kind: "tone", waveform: "sine", frequency: 1180, attack: 0.001, decay: 0.164, peak: 0.008 },
      { kind: "tone", waveform: "sine", frequency: 3242, attack: 0.001, decay: 0.0827, peak: 0.0055 },
      knock(300, 0.0261, 0.02, { from: "normal" }),
      { from: "strong", kind: "tone", waveform: "sine", frequency: 587.33, attack: 0.002, decay: 0.246, peak: 0.009 },
      knock(150, 0.0489, 0.014, { from: "strong" }),
    ],
    vary: { pitch: 0.012, level: 0.12 },
  },
  /**
   * One keyboard keystroke — the switch's click, the keycap's clack, and the
   * thock of bottoming out, all in one strike. Every stroke
   * lands at a slightly different pitch and weight, like different keys.
   */
  type: {
    masterGain: 0.375,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 3900, filterQ: 0.8, attack: 0.001, decay: 0.00517, peak: 0.08 },
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 1550, filterQ: 3.5, attack: 0.001, decay: 0.0144, peak: 0.22 },
      { kind: "noise", filterType: "bandpass", filterFrequency: 310, filterQ: 2.5, attack: 0.002, decay: 0.0254, peak: 0.35 },
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 140, filterQ: 2, attack: 0.002, decay: 0.037, peak: 0.45 },
    ],
    vary: { pitch: 0.07, level: 0.2 },
  },
  /** A crisp detent over a small wooden knock — dropdowns, menus, lists. */
  select: {
    masterGain: 0.306,
    layers: [
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 2800, filterQ: 2.2, attack: 0.001, decay: 0.00749, peak: 0.16 },
      knock(415, 0.0194, 0.03),
      knock(208, 0.0313, 0.025, { from: "strong" }),
    ],
  },
  /** A switch snapping over: one crisp click with a small knock of body. Switching off knocks upward. */
  toggle: {
    masterGain: 0.24,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 1830, filterQ: 1.6, attack: 0.001, decay: 0.0156, peak: 0.12 },
      knock(330, 0.0339, 0.045),
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 3150, filterQ: 1.6, attack: 0.001, decay: 0.0124, peak: 0.08 },
      knock(165, 0.0375, 0.025, { from: "strong" }),
    ],
  },
  /** Air drawing upward with a light note swelling inside it: one breath as a panel opens — menus, drawers, dialogs. */
  open: {
    masterGain: 0.335,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 600, glideTo: 1500, glideTime: 0.1, filterQ: 1.4, attack: 0.05, decay: 0.0558, peak: 0.168 },
      { kind: "tone", waveform: "sine", frequency: 659.25, attack: 0.05, decay: 0.165, peak: 0.015 },
      { from: "normal", kind: "tone", waveform: "sine", frequency: 1318.51, attack: 0.05, decay: 0.0883, peak: 0.005 },
      { from: "strong", kind: "noise", filterType: "lowpass", filterFrequency: 250, filterQ: 0.7, attack: 0.04, decay: 0.0779, peak: 0.12 },
    ],
  },
  /** The same air falling shut over a low, damped mallet note — closing and dismissing. */
  close: {
    masterGain: 0.258,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 1400, glideTo: 540, glideTime: 0.07, filterQ: 1.4, attack: 0.02, decay: 0.054, peak: 0.216 },
      { kind: "tone", waveform: "sine", frequency: 261.63, attack: 0.003, decay: 0.104, peak: 0.02 },
      { from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 350, filterQ: 2, attack: 0.001, decay: 0.0273, peak: 0.2 },
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 165, filterQ: 2, attack: 0.001, decay: 0.0345, peak: 0.3 },
    ],
  },
  /** One soft mallet chord, C, G and E spread wide so no two notes rub, struck with felt in a small room — confirmed completion. */
  success: {
    masterGain: 0.566,
    layers: [
      contact(1500, 0.04),
      ...struck(523.25, 0.333, 0.022, MALLET),
      ...struck(783.99, 0.391, 0.02, MALLET),
      ...struck(1318.51, 0.335, 0.014, MALLET),
      ...struck(261.63, 0.469, 0.02, MALLET, { from: "strong" }),
    ],
    room: LANDED,
  },
  /** One muted low mallet chord, D with the F a tenth above, spread so it never rubs, short — a calm, recoverable refusal. */
  error: {
    masterGain: 0.501,
    layers: [
      contact(900, 0.05),
      ...struck(293.66, 0.138, 0.04, MALLET),
      ...struck(698.46, 0.106, 0.018, MALLET),
      { from: "strong", kind: "noise", filterType: "bandpass", filterFrequency: 250, filterQ: 1.5, attack: 0.001, decay: 0.0273, peak: 0.2 },
    ],
  },
  /** A soft whoosh whose air rises as it passes — routes, pages, galleries, carousels. */
  navigate: {
    masterGain: 0.322,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 400, glideTo: 1100, glideTime: 0.21, filterQ: 1.2, attack: 0.12, decay: 0.111, peak: 0.18 },
      { from: "normal", kind: "noise", filterType: "lowpass", filterFrequency: 540, filterQ: 0.7, attack: 0.09, decay: 0.109, peak: 0.045 },
      { from: "strong", kind: "noise", filterType: "lowpass", filterFrequency: 230, filterQ: 0.7, attack: 0.1, decay: 0.144, peak: 0.1 },
    ],
  },
  /** One mallet fifth, A and E, neither bright nor low: between success and error. */
  warning: {
    masterGain: 0.437,
    layers: [
      contact(1200, 0.04),
      ...struck(440, 0.163, 0.038, MALLET),
      ...struck(659.25, 0.145, 0.03, MALLET),
      ...struck(220, 0.261, 0.02, MALLET, { from: "strong" }),
    ],
  },
  /** One low, muted note that swells in and fades away over about a second, never struck: work has begun, nothing has landed. */
  loading: {
    masterGain: 0.106,
    layers: [
      { kind: "tone", waveform: "sine", frequency: 196, attack: 0.35, decay: 0.969, peak: 0.03 },
      { kind: "tone", waveform: "sine", frequency: 392, attack: 0.35, decay: 0.9, peak: 0.01 },
      { from: "normal", kind: "noise", filterType: "lowpass", filterFrequency: 500, filterQ: 0.7, attack: 0.35, decay: 0.844, peak: 0.006 },
      { from: "strong", kind: "tone", waveform: "sine", frequency: 98, attack: 0.35, decay: 1.04, peak: 0.02 },
    ],
  },
  /**
   * One warm glass note, G, below success, in its small room: a result is
   * there. A second mode a hertz sharp lets the glass shimmer once as it
   * rings, too slow to be heard as a wobble.
   */
  ready: {
    masterGain: 0.467,
    layers: [
      contact(1500, 0.02),
      ...struck(392, 0.497, 0.026, BAR),
      { kind: "tone", waveform: "sine", frequency: 393.2, attack: 0.003, decay: 0.462, peak: 0.012 },
      ...struck(196, 0.612, 0.016, BAR, { from: "strong" }),
    ],
    room: LANDED,
  },
  /**
   * One high glass bell, A and E struck together, ringing longest: blocked
   * until the user answers. The A's twin sits 2 Hz sharp, so the bell swells
   * once rather than warbling.
   */
  attention: {
    masterGain: 0.551,
    layers: [
      contact(2500, 0.02),
      ...struck(880, 0.599, 0.018, BAR),
      { kind: "tone", waveform: "sine", frequency: 882, attack: 0.003, decay: 0.57, peak: 0.01 },
      ...struck(1318.51, 0.559, 0.014, BAR),
      ...struck(440, 0.649, 0.012, BAR, { from: "strong" }),
    ],
  },
  /**
   * A number rolling to a new value: one breath of air that rises with the
   * count (and falls counting down) over a soft glass note, lasting as long
   * as the roll.
   */
  count: {
    masterGain: 0.336,
    layers: [
      { stretch: true, kind: "noise", filterType: "bandpass", filterFrequency: 700, glideTo: 1400, glideTime: 0.6, filterQ: 1.2, attack: 0.15, decay: 0.611, peak: 0.05 },
      { stretch: true, kind: "tone", waveform: "sine", frequency: 1046.5, attack: 0.15, decay: 0.721, peak: 0.012 },
      { stretch: true, from: "normal", kind: "noise", filterType: "bandpass", filterFrequency: 2000, glideTo: 3200, glideTime: 0.6, filterQ: 2, attack: 0.15, decay: 0.652, peak: 0.02 },
      { stretch: true, from: "strong", kind: "tone", waveform: "sine", frequency: 261.63, attack: 0.15, decay: 0.758, peak: 0.015 },
    ],
    vary: { pitch: 0.02, level: 0.12 },
  },
} satisfies Record<string, SoundRecipe>;

export type SoundName = keyof typeof RECIPES;

/** All canonical cue names, derived from the recipe palette. */
export const sounds = Object.keys(RECIPES) as readonly SoundName[];

/** The v0.2 palette, mapped to the cue that now does each job. Removed in 1.0. */
const ALIASES = {
  chime: "success",
  sparkle: "success",
  droplet: "close",
  bloom: "open",
  whisper: "select",
  tick: "select",
  press: "tap",
  release: "tap",
  page: "navigate",
  pulse: "tap",
  scan: "select",
  arrival: "navigate",
} as const satisfies Record<string, SoundName>;

export type LegacySoundName = keyof typeof ALIASES;

const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** Maps a canonical or deprecated name to its canonical cue; anything else is `null`. */
export function resolveSound(value: unknown): SoundName | null {
  if (typeof value !== "string") return null;
  if (own(RECIPES, value)) return value as SoundName;
  return own(ALIASES, value) ? ALIASES[value as LegacySoundName] : null;
}
