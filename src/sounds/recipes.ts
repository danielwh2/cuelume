/**
 * The sound palette — layer/recipe types plus the seventeen built-in recipes.
 * Each sound has its own distinct shape — a struck-glass note, an arpeggio,
 * a pitch glide, a warm pad, a breath — rather than being a volume/EQ tweak
 * on the same click. Every pitched cue sits in A major, so cues that overlap
 * (a hover under a press, a success over a page flick) always harmonize.
 * Add a new one here without touching any audio graph code.
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
  /** Stereo position from -1 (left) to 1 (right). Defaults to centre. */
  pan?: number;
};

/** A single note — the building block for chimes, arpeggios, and pads. */
export type ToneLayer = BaseLayer & {
  kind: "tone";
  waveform: OscillatorType;
  frequency: number;
  /** Detune in cents, for a gentle chorus/beating effect between layers. */
  detune?: number;
  /** If set, the pitch glides smoothly from `frequency` to this value. */
  glideTo?: number;
  /** How long the glide takes, in seconds. Defaults to attack + decay. */
  glideTime?: number;
};

/** A soft filtered noise bed — used for breathy, textural layers. */
export type NoiseLayer = BaseLayer & {
  kind: "noise";
  filterType: BiquadFilterType;
  filterFrequency: number;
  filterQ?: number;
};

export type SoundLayer = ToneLayer | NoiseLayer;

export type SoundRecipe = {
  masterGain: number;
  layers: SoundLayer[];
  /** How much of the sound is sent into the shared small room, 0–1. Omit for a dry cue. */
  space?: number;
};

/** A-major pitches (A4 = 440 Hz). */
const A3 = 220;
const E4 = 329.63;
const A4 = 440;
const B4 = 493.88;
const CS5 = 554.37;
const E5 = 659.25;
const FS5 = 739.99;
const A5 = 880;
const B5 = 987.77;
const CS6 = 1108.73;
const E6 = 1318.51;
const FS6 = 1479.98;
const A6 = 1760;
const CS7 = 2217.46;
const E7 = 2637.02;
const A7 = 3520;

type NoteOptions = { offset?: number; decay: number; peak: number; pan?: number };

/**
 * A struck-glass note: a sine fundamental plus a quiet inharmonic partial
 * (2.76×, as on a glockenspiel bar) that dies away first. The partial is what
 * turns a plain beep into a "tink".
 */
function glass(frequency: number, { offset = 0, decay, peak, pan }: NoteOptions): SoundLayer[] {
  return [
    { kind: "tone", waveform: "sine", frequency, offset, attack: 0.002, decay, peak, pan },
    {
      kind: "tone",
      waveform: "sine",
      frequency: frequency * 2.76,
      offset,
      attack: 0.001,
      decay: decay * 0.25,
      peak: peak * 0.12,
      pan,
    },
  ];
}

/** A short low thud that gives clicks a physical body, like a key bottoming out. */
function body(peak: number, offset = 0, from = 170, to = 65): ToneLayer {
  return {
    kind: "tone",
    waveform: "sine",
    frequency: from,
    glideTo: to,
    glideTime: 0.03,
    offset,
    attack: 0.001,
    decay: 0.045,
    peak,
  };
}

export const RECIPES = {
  /** A soft two-note ascending glass tink, like an iOS/macOS confirmation. */
  chime: {
    masterGain: 0.38,
    layers: [
      ...glass(E6, { decay: 0.18, peak: 0.09 }),
      ...glass(A6, { offset: 0.07, decay: 0.22, peak: 0.08 }),
    ],
    space: 0.2,
  },
  /** A quick ascending twinkle of four glass notes sweeping left to right. */
  sparkle: {
    masterGain: 0.9,
    layers: [
      ...glass(A6, { decay: 0.1, peak: 0.05, pan: -0.5 }),
      ...glass(CS7, { offset: 0.04, decay: 0.1, peak: 0.045, pan: -0.17 }),
      ...glass(E7, { offset: 0.08, decay: 0.12, peak: 0.04, pan: 0.17 }),
      ...glass(A7, { offset: 0.12, decay: 0.16, peak: 0.035, pan: 0.5 }),
    ],
    space: 0.35,
  },
  /** A tap on glass that dips a fifth and settles — a drop landing, not a bubble. */
  droplet: {
    masterGain: 0.28,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 3000, filterQ: 1.5, attack: 0.001, decay: 0.008, peak: 0.08 },
      { kind: "tone", waveform: "sine", frequency: E6, glideTo: A5, glideTime: 0.06, attack: 0.002, decay: 0.16, peak: 0.09 },
      { kind: "tone", waveform: "sine", frequency: E6 * 2.76, attack: 0.001, decay: 0.04, peak: 0.011 },
      body(0.05),
    ],
    space: 0.15,
  },
  /** A warm, slow-swelling A-major pad that opens up and settles. */
  bloom: {
    masterGain: 0.35,
    layers: [
      { kind: "tone", waveform: "sine", frequency: A4, attack: 0.09, decay: 0.42, peak: 0.06 },
      { kind: "tone", waveform: "sine", frequency: A4, detune: 7, attack: 0.09, decay: 0.45, peak: 0.05 },
      { kind: "tone", waveform: "sine", frequency: CS5, attack: 0.12, decay: 0.4, peak: 0.035 },
      { kind: "tone", waveform: "sine", frequency: E5, attack: 0.14, decay: 0.38, peak: 0.03 },
      { kind: "tone", waveform: "sine", frequency: A5, offset: 0.08, attack: 0.12, decay: 0.35, peak: 0.02 },
    ],
    space: 0.4,
  },
  /** A soft hush with a falling tone — for tooltips and low-priority previews. */
  whisper: {
    masterGain: 0.68,
    layers: [
      { kind: "noise", filterType: "lowpass", filterFrequency: 1600, filterQ: 0.7, attack: 0.03, decay: 0.14, peak: 0.04 },
      { kind: "tone", waveform: "sine", frequency: E5, glideTo: CS5, glideTime: 0.14, offset: 0.01, attack: 0.02, decay: 0.14, peak: 0.025 },
    ],
    space: 0.1,
  },
  /** A focused tick with a little body and a bright ping on top — crisp and instant. */
  tick: {
    masterGain: 0.43,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 6200, filterQ: 2, attack: 0.001, decay: 0.014, peak: 0.14 },
      { kind: "noise", filterType: "lowpass", filterFrequency: 2200, filterQ: 0.7, attack: 0.001, decay: 0.01, peak: 0.08 },
      { kind: "tone", waveform: "sine", frequency: A7, attack: 0.001, decay: 0.014, peak: 0.02 },
    ],
  },
  /** A muted knock with a low thud — the "down" half of a press/release pair, like a key bottoming out. */
  press: {
    masterGain: 0.21,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 1300, filterQ: 1.2, attack: 0.001, decay: 0.018, peak: 0.12 },
      { kind: "noise", filterType: "lowpass", filterFrequency: 600, filterQ: 0.7, attack: 0.001, decay: 0.03, peak: 0.1 },
      body(0.14),
    ],
  },
  /** A brighter, springier tick with a lighter thud — the "up" half, like a key returning. */
  release: {
    masterGain: 0.27,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 4200, filterQ: 1.8, attack: 0.001, decay: 0.014, peak: 0.11 },
      { kind: "tone", waveform: "sine", frequency: A6, offset: 0.004, attack: 0.001, decay: 0.04, peak: 0.025 },
      body(0.06, 0, 260, 110),
    ],
  },
  /** A two-part click-clack with body, like a mechanical switch flipping between states. */
  toggle: {
    masterGain: 0.3,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 1800, filterQ: 1.5, attack: 0.001, decay: 0.014, peak: 0.12 },
      body(0.1),
      { kind: "noise", filterType: "bandpass", filterFrequency: 3200, filterQ: 1.6, offset: 0.03, attack: 0.001, decay: 0.016, peak: 0.09 },
      { kind: "tone", waveform: "sine", frequency: E6, offset: 0.03, attack: 0.001, decay: 0.03, peak: 0.02 },
      body(0.05, 0.03, 220, 90),
    ],
  },
  /** A short, warm three-note ascending confirmation over a soft root — "done", not a fanfare. */
  success: {
    masterGain: 0.5,
    layers: [
      ...glass(A5, { decay: 0.12, peak: 0.06 }),
      ...glass(CS6, { offset: 0.07, decay: 0.13, peak: 0.06 }),
      ...glass(E6, { offset: 0.14, decay: 0.32, peak: 0.075 }),
      { kind: "tone", waveform: "sine", frequency: A4, offset: 0.14, attack: 0.01, decay: 0.3, peak: 0.03 },
    ],
    space: 0.3,
  },
  /** A muted knock followed by two descending tones — a calm, recoverable refusal. */
  error: {
    masterGain: 0.35,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 700, filterQ: 1, attack: 0.001, decay: 0.03, peak: 0.12 },
      body(0.12, 0, 140, 55),
      { kind: "tone", waveform: "sine", frequency: E5, offset: 0.03, attack: 0.004, decay: 0.1, peak: 0.045 },
      { kind: "tone", waveform: "sine", frequency: E5 * 2, offset: 0.03, attack: 0.004, decay: 0.05, peak: 0.008 },
      { kind: "tone", waveform: "sine", frequency: B4, offset: 0.11, attack: 0.004, decay: 0.16, peak: 0.04 },
      { kind: "tone", waveform: "sine", frequency: B4 * 2, offset: 0.11, attack: 0.004, decay: 0.07, peak: 0.007 },
    ],
    space: 0.1,
  },
  /** A papery flick that crosses the stereo field, with a tiny glass tick — for pages, galleries, and carousels. */
  page: {
    masterGain: 0.75,
    layers: [
      { kind: "noise", filterType: "lowpass", filterFrequency: 1800, filterQ: 0.7, attack: 0.006, decay: 0.07, peak: 0.11, pan: -0.3 },
      { kind: "noise", filterType: "bandpass", filterFrequency: 4000, filterQ: 1.2, offset: 0.035, attack: 0.004, decay: 0.06, peak: 0.08, pan: 0.3 },
      ...glass(E7, { offset: 0.065, decay: 0.04, peak: 0.02 }),
    ],
    space: 0.1,
  },
  /** A brief unresolved lift that lands on the second — user-initiated work has started. */
  loading: {
    masterGain: 0.7,
    layers: [
      { kind: "noise", filterType: "lowpass", filterFrequency: 1400, filterQ: 0.6, attack: 0.04, decay: 0.14, peak: 0.03 },
      { kind: "tone", waveform: "sine", frequency: E4, glideTo: B4, glideTime: 0.18, attack: 0.03, decay: 0.18, peak: 0.05 },
      ...glass(FS5, { offset: 0.12, decay: 0.2, peak: 0.03 }),
    ],
    space: 0.3,
  },
  /** A quick lock-on sweep up an octave resolving to a clear glass chord — the system is ready. */
  ready: {
    masterGain: 0.5,
    layers: [
      { kind: "noise", filterType: "bandpass", filterFrequency: 3600, filterQ: 1.8, attack: 0.001, decay: 0.02, peak: 0.1 },
      { kind: "tone", waveform: "sine", frequency: A4, glideTo: A5, glideTime: 0.11, offset: 0.01, attack: 0.004, decay: 0.15, peak: 0.055 },
      ...glass(E6, { offset: 0.12, decay: 0.24, peak: 0.06 }),
      ...glass(A6, { offset: 0.12, decay: 0.22, peak: 0.03 }),
    ],
    space: 0.25,
  },
  /** A compact synthetic chirp up an octave with a little thud — crisp feedback for primary buttons. */
  pulse: {
    masterGain: 0.3,
    layers: [
      body(0.08, 0, 160, 70),
      { kind: "noise", filterType: "bandpass", filterFrequency: 2600, filterQ: 2.4, attack: 0.001, decay: 0.02, peak: 0.08 },
      { kind: "tone", waveform: "sine", frequency: A5, glideTo: A6, glideTime: 0.06, attack: 0.002, decay: 0.08, peak: 0.055 },
    ],
    space: 0.1,
  },
  /** A fast three-step locator in stacked fifths, sweeping left to right — for menus and secondary buttons. */
  scan: {
    masterGain: 0.68,
    layers: [
      ...glass(E5, { decay: 0.06, peak: 0.05, pan: -0.4 }),
      ...glass(B5, { offset: 0.045, decay: 0.06, peak: 0.045 }),
      ...glass(FS6, { offset: 0.09, decay: 0.08, peak: 0.04, pan: 0.4 }),
    ],
    space: 0.15,
  },
  /** A rising harmonic portal that stacks an A-major chord with a soft tail — for client-side page arrivals. */
  arrival: {
    masterGain: 0.78,
    layers: [
      { kind: "noise", filterType: "lowpass", filterFrequency: 900, filterQ: 0.8, attack: 0.06, decay: 0.26, peak: 0.035 },
      { kind: "tone", waveform: "sine", frequency: A3, glideTo: A4, glideTime: 0.32, attack: 0.05, decay: 0.36, peak: 0.055 },
      { kind: "tone", waveform: "sine", frequency: E5, offset: 0.12, attack: 0.05, decay: 0.34, peak: 0.04 },
      { kind: "tone", waveform: "sine", frequency: A5, offset: 0.2, attack: 0.05, decay: 0.34, peak: 0.032 },
      ...glass(CS6, { offset: 0.3, decay: 0.3, peak: 0.025 }),
    ],
    space: 0.45,
  },
} as const satisfies Record<string, SoundRecipe>;

export type SoundName = keyof typeof RECIPES;

export function isSoundName(value: unknown): value is SoundName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RECIPES, value);
}

/** All available sound names, derived from the recipe palette. */
export const sounds = Object.keys(RECIPES) as readonly SoundName[];
