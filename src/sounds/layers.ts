/**
 * Layers — the building blocks every cue is made of: one tone or one burst
 * of filtered noise, shaped by an attack/decay envelope. The builders below
 * (`knock`, `struck`, `click`, …) are how themes spell real materials —
 * a struck bar, a switch click, a breath of air — out of those layers.
 */

type BaseLayer = {
  /** Seconds after the trigger that this layer starts. */
  offset?: number;
  /** Fade-in time, in seconds. */
  attack: number;
  /** Fade-out time, in seconds, starting right after the attack. */
  decay: number;
  /** Peak volume reached at the end of the attack. */
  peak: number;
  /** If set, the layer's pitch (a tone's frequency, a noise layer's filter) glides to this value. */
  glideTo?: number;
  /** How long the glide takes, in seconds. Defaults to attack + decay. */
  glideTime?: number;
  /**
   * The lowest emphasis this layer plays at. Unset plays at every level;
   * "normal" drops out of subtle; "strong" plays only when strong.
   */
  from?: "normal" | "strong";
  /** For `count`: this layer lasts as long as the count, not only starts in step with it. */
  stretch?: true;
  /** A pitched note: it moves with the cue's walk, and lets go slowly when the cue plays again. */
  note?: true;
};

/** A single note — the building block for chimes, arpeggios, and pads. */
export type ToneLayer = BaseLayer & {
  kind: "tone";
  waveform: "sine" | "square" | "sawtooth" | "triangle";
  frequency: number;
  /** Detune in cents, for a gentle chorus/beating effect between layers. */
  detune?: number;
};

/** Filtered noise — clicks, knocks, and air. */
export type NoiseLayer = BaseLayer & {
  kind: "noise";
  filterType: "lowpass" | "highpass" | "bandpass";
  filterFrequency: number;
  filterQ?: number;
};

export type SoundLayer = ToneLayer | NoiseLayer;

/** Per-play randomness, as fractions: each layer's pitch and level move by up to ± these. */
export type Variation = {
  pitch: number;
  level: number;
};

export type SoundRecipe = {
  masterGain: number;
  layers: SoundLayer[];
  /**
   * How strongly this cue rings into the shared room, as a multiple of every
   * cue's faint send. Results that land ring in it more.
   */
  room?: number;
  vary?: Variation;
  /**
   * What the gesture sounds like as it lets go: pointer up, key up. A binding
   * plays these when the gesture lifts; `play()` plays them RELEASE_GAP after
   * the press. Outcomes have none: nothing was pressed.
   */
  release?: SoundLayer[];
  /**
   * Semitones above the note that quick repeats of the cue step through, on
   * its `note` layers only. A pause starts the walk again from the first.
   */
  walk?: number[];
};

/**
 * Success and ready ring into the room 6 dB more than the rest, about 16 dB
 * under the sound itself: a result lands in the space without sounding far.
 */
export const LANDED = 2;

/** How far sharp a knock is struck, and how fast it drops to its pitch. */
const KNOCK_DROP = 1.6;
const KNOCK_DROP_TIME = 0.018;

/**
 * A knock's body: a sine struck sharp that drops to `frequency` in 18 ms, the
 * way a small hollow part answers a tap. Heard as a soft "tok", never as a
 * slide. Measured from the keycap sounds in DawoodUI's Artasaka preview.
 */
export const knock = (frequency: number, decay: number, peak: number, more: Partial<ToneLayer> = {}): ToneLayer => ({
  kind: "tone", waveform: "sine", frequency: frequency * KNOCK_DROP, glideTo: frequency, glideTime: KNOCK_DROP_TIME,
  attack: 0.001, decay, peak, ...more,
});

/**
 * A struck object's modes as [ratio to the fundamental, level] pairs. The
 * ratios are what tells the ear "bar" rather than "synth": real bars are
 * inharmonic.
 */
type Material = readonly (readonly [ratio: number, level: number])[];

/** A free bar, glass or metal: modes at 1, 2.76 and 5.40 times the fundamental (euphonics.org, free-free bar). */
export const BAR: Material = [[1, 1], [2.76, 0.3], [5.4, 0.1]];
/** A marimba bar, undercut so its second mode sits at 3.99x (STK ModalBar's marimba). Rounder than a free bar. */
export const MALLET: Material = [[1, 1], [3.99, 0.2]];

/** Modes above this are left out: the register ceiling every theme keeps. */
const MODE_CEILING = 5000;
/** A struck tone swells in over 3 ms: short enough to strike, long enough not to click. */
const STRIKE_ATTACK = 0.003;
/** No mode dies faster than this, or it stops being heard as a pitch. */
const SHORTEST_MODE = 0.015;

/**
 * A struck note: one sine per mode of `material`. Each mode dies in inverse
 * proportion to its pitch, so the highs go first as on any real bar (decay
 * time falls as 1/f, van den Doel and Pai). Upper modes are ornament that
 * subtle leaves out; `from` moves the whole note to a higher emphasis.
 */
export function struck(
  frequency: number,
  decay: number,
  peak: number,
  material: Material,
  { from }: { from?: "normal" | "strong" } = {},
): ToneLayer[] {
  return material
    .filter(([ratio]) => frequency * ratio <= MODE_CEILING)
    .map(([ratio, level], mode) => {
      const layerFrom = mode === 0 ? from : (from ?? "normal");
      return {
        kind: "tone", waveform: "sine", frequency: frequency * ratio, attack: STRIKE_ATTACK,
        decay: Math.max(SHORTEST_MODE, decay / ratio), peak: peak * level, ...(layerFrom ? { from: layerFrom } : {}),
      };
    });
}

/** Lowpass Q in dB that gives a flat, unresonant corner. Web Audio reads a lowpass Q in dB. */
export const FLAT_Q = -3;

/**
 * The mallet meeting the bar: 3 ms of noise, low-passed at the mallet's
 * hardness. A soft felt mallet sits near 1 kHz, a hard one near 3 kHz. It
 * makes a chord a struck object rather than a test tone.
 */
export const contact = (hardness: number, peak: number, more: Partial<NoiseLayer> = {}): NoiseLayer => ({
  kind: "noise", filterType: "lowpass", filterFrequency: hardness, filterQ: FLAT_Q, attack: 0.001, decay: 0.003, peak, ...more,
});

/**
 * One resonance of a switch's click: a narrow ring that dies in about 5 ms.
 * Measured from the Subscribe press in DawoodUI's Artasaka preview.
 */
export const ring = (frequency: number, peak: number, more: Partial<NoiseLayer> = {}): NoiseLayer => ({
  kind: "noise", filterType: "bandpass", filterFrequency: frequency, filterQ: 8, attack: 0.001, decay: 0.006, peak, ...more,
});

/** How far below its ring a click's body sits. */
const CLICK_BODY = 0.675;

/**
 * A click: a tight ring over a softer, wider body below it, so the energy
 * spreads the way a real switch's does. The Artasaka press rings at 4 kHz and
 * lets go at 4.8 kHz, 5 dB quieter.
 */
export const click = (frequency: number, peak: number, more: Partial<NoiseLayer> = {}): NoiseLayer[] => [
  ring(frequency, peak, more),
  ring(frequency * CLICK_BODY, peak * 0.5, { filterQ: 2, ...more }),
];

/** Air moved by a part: filtered noise that sweeps from `from` to `to` Hz. */
export const air = (from: number, to: number, decay: number, peak: number, more: Partial<NoiseLayer> = {}): NoiseLayer => ({
  kind: "noise", filterType: "bandpass", filterFrequency: from, glideTo: to, glideTime: decay, filterQ: 1.5, attack: 0.008, decay, peak, ...more,
});

/** A dull thud: a part hitting its stop. */
export const thud = (frequency: number, decay: number, peak: number, more: Partial<NoiseLayer> = {}): NoiseLayer => ({
  kind: "noise", filterType: "lowpass", filterFrequency: frequency, filterQ: 0.7, attack: 0.001, decay, peak, ...more,
});

/**
 * A note's partials as the Artasaka press sounds them: [multiple, share of
 * the ring, level]. The octave at -6 dB carries a low note on small speakers;
 * the faint third and fourth give it its edge.
 */
const NOTE_PARTIALS = [[1, 1, 1], [2, 0.8, 0.5], [3, 0.5, 0.04], [4, 0.4, 0.056]] as const;
/** The note starts 9% sharp and settles within 15 ms. */
const NOTE_SHARP = 1.09;
const NOTE_SETTLE = 0.015;
/** It swells in rather than striking: the video's peaks 105–125 ms after the click. */
const NOTE_SWELL = 0.11;

/**
 * A deep note that swells in under a click and rings on, as the Artasaka
 * press does. With a `decay` of 1.4 s it falls about 45 dB a second, as the
 * video's does.
 * Upper partials are ornament that subtle leaves out; `from` moves the whole
 * note to a higher emphasis.
 */
export function note(
  frequency: number,
  decay: number,
  peak: number,
  { from }: { from?: "normal" | "strong" } = {},
): ToneLayer[] {
  const attack = Math.min(NOTE_SWELL, decay / 2);
  return NOTE_PARTIALS.map(([multiple, length, level], partial) => {
    const layerFrom = partial < 2 ? from : (from ?? "normal");
    return {
      note: true, kind: "tone", waveform: "sine", frequency: frequency * multiple * NOTE_SHARP, glideTo: frequency * multiple,
      glideTime: NOTE_SETTLE, attack, decay: decay * length, peak: peak * level, ...(layerFrom ? { from: layerFrom } : {}),
    };
  });
}
