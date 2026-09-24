/**
 * The sound palette — nine semantic cues, each designed in two themes.
 * `default` is tactile, warm, and lightly organic; `mech` is dry, precise,
 * and mechanical. Names describe interface jobs, not synthesis styles, so
 * a theme changes the material of a cue but never its meaning.
 *
 * Every pitched cue sits in A major, so cues that overlap (a select under a
 * tap, a success over a navigate) always harmonize. Add or retune a cue here
 * without touching any audio graph code.
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

/** A single note — the building block for tinks, glides, and pads. */
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

/** A soft filtered noise bed — used for clicks, breaths, and textures. */
export type NoiseLayer = BaseLayer & {
  kind: "noise";
  filterType: BiquadFilterType;
  filterFrequency: number;
  filterQ?: number;
  /** If set, the filter sweeps smoothly from `filterFrequency` to this value. */
  filterGlideTo?: number;
  /** How long the filter sweep takes, in seconds. Defaults to attack + decay. */
  filterGlideTime?: number;
};

export type SoundLayer = ToneLayer | NoiseLayer;

export type SoundRecipe = {
  masterGain: number;
  layers: SoundLayer[];
  /** How much of the sound is sent into the shared small room, 0–1. Omit for a dry cue. */
  space?: number;
  /** Random per-play detune range in cents, so rapid repeats never sound machine-stamped. */
  variation?: number;
};

/** The nine canonical cues, in catalog order. */
export const sounds = [
  "tap",
  "type",
  "select",
  "toggle",
  "open",
  "close",
  "success",
  "error",
  "navigate",
] as const;

export type SoundName = (typeof sounds)[number];

/** Pre-0.3 names, accepted by `play()` for one migration release. */
export const LEGACY_SOUNDS = {
  chime: "success",
  sparkle: "success",
  droplet: "close",
  bloom: "open",
  whisper: "select",
  tick: "select",
  press: "tap",
  release: "select",
  page: "navigate",
  loading: "open",
  ready: "success",
  pulse: "tap",
  scan: "select",
  arrival: "navigate",
} as const satisfies Record<string, SoundName>;

export type LegacySoundName = keyof typeof LEGACY_SOUNDS;

export function isSoundName(value: unknown): value is SoundName {
  return typeof value === "string" && (sounds as readonly string[]).includes(value);
}

/** Resolves a canonical or legacy name to its canonical cue, or null. */
export function resolveSoundName(value: unknown): SoundName | null {
  if (isSoundName(value)) return value;
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_SOUNDS, value)
    ? LEGACY_SOUNDS[value as LegacySoundName]
    : null;
}

export const themes = ["default", "mech"] as const;

export type ThemeName = (typeof themes)[number];

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (themes as readonly string[]).includes(value);
}

/** A-major pitches (A4 = 440 Hz). */
const E4 = 329.63;
const A4 = 440;
const B4 = 493.88;
const E5 = 659.25;
const A5 = 880;
const E6 = 1318.51;
const A6 = 1760;
const E7 = 2637.02;

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
function body(peak: number, offset = 0, from = 170, to = 65, decay = 0.045): ToneLayer {
  return {
    kind: "tone",
    waveform: "sine",
    frequency: from,
    glideTo: to,
    glideTime: 0.03,
    offset,
    attack: 0.001,
    decay,
    peak,
  };
}

/** A filtered noise burst — the click, knock, or hush part of a cue. */
function noise(
  filterType: BiquadFilterType,
  filterFrequency: number,
  filterQ: number,
  decay: number,
  peak: number,
  extra: Partial<NoiseLayer> = {},
): NoiseLayer {
  return { kind: "noise", filterType, filterFrequency, filterQ, attack: 0.001, decay, peak, ...extra };
}

const DEFAULT: Record<SoundName, SoundRecipe> = {
  /** A compact tactile pop: knock, low thud, and a glint of pitch. */
  tap: {
    masterGain: 0.18,
    layers: [
      noise("bandpass", 1400, 1.2, 0.016, 0.12),
      noise("lowpass", 700, 0.7, 0.025, 0.08),
      body(0.14),
      { kind: "tone", waveform: "sine", frequency: A6, attack: 0.001, decay: 0.025, peak: 0.02 },
    ],
  },
  /** A soft rounded keycap, slightly different every time. */
  type: {
    masterGain: 0.28,
    layers: [
      noise("lowpass", 1200, 0.7, 0.014, 0.1),
      body(0.07, 0, 150, 80, 0.035),
      { kind: "tone", waveform: "sine", frequency: A5, attack: 0.001, decay: 0.02, peak: 0.015 },
    ],
    variation: 40,
  },
  /** A short precise pluck, like a detent clicking into place. */
  select: {
    masterGain: 0.66,
    layers: [noise("bandpass", 5200, 2, 0.01, 0.12), ...glass(E6, { decay: 0.05, peak: 0.035 })],
  },
  /** A two-part click-clack with body, like a switch flipping between states. */
  toggle: {
    masterGain: 0.25,
    layers: [
      noise("bandpass", 1800, 1.5, 0.014, 0.12),
      body(0.1),
      noise("bandpass", 3200, 1.6, 0.016, 0.09, { offset: 0.03 }),
      { kind: "tone", waveform: "sine", frequency: E6, offset: 0.03, attack: 0.001, decay: 0.03, peak: 0.02 },
      body(0.05, 0.03, 220, 90),
    ],
  },
  /** A gooey elastic stretch up an octave that pops open at the top. */
  open: {
    masterGain: 0.37,
    layers: [
      body(0.06),
      { kind: "tone", waveform: "sine", frequency: E4, glideTo: E5, glideTime: 0.09, attack: 0.004, decay: 0.14, peak: 0.07 },
      { kind: "tone", waveform: "sine", frequency: A4, glideTo: A5, glideTime: 0.09, offset: 0.01, attack: 0.004, decay: 0.13, peak: 0.035 },
      noise("bandpass", 2400, 1.5, 0.012, 0.09, { offset: 0.085 }),
      ...glass(E6, { offset: 0.085, decay: 0.12, peak: 0.05 }),
    ],
    space: 0.2,
  },
  /** A short soft suction: the pitch and the air both drop, then land. */
  close: {
    masterGain: 0.46,
    layers: [
      noise("bandpass", 2600, 1.2, 0.1, 0.09, { attack: 0.003, filterGlideTo: 400, filterGlideTime: 0.1 }),
      { kind: "tone", waveform: "sine", frequency: E5, glideTo: E4, glideTime: 0.08, attack: 0.003, decay: 0.11, peak: 0.06 },
      { kind: "tone", waveform: "sine", frequency: A5, glideTo: A4, glideTime: 0.08, offset: 0.005, attack: 0.003, decay: 0.1, peak: 0.03 },
      body(0.05, 0.07),
    ],
    space: 0.12,
  },
  /** A warm restrained resolve: two glass notes over a soft root. */
  success: {
    masterGain: 0.5,
    layers: [
      ...glass(A5, { decay: 0.12, peak: 0.06 }),
      ...glass(E6, { offset: 0.08, decay: 0.32, peak: 0.075 }),
      { kind: "tone", waveform: "sine", frequency: A4, offset: 0.08, attack: 0.01, decay: 0.3, peak: 0.03 },
    ],
    space: 0.3,
  },
  /** A muted knock followed by two descending tones — a calm, recoverable refusal. */
  error: {
    masterGain: 0.41,
    layers: [
      noise("bandpass", 700, 1, 0.03, 0.12),
      body(0.12, 0, 140, 55),
      { kind: "tone", waveform: "sine", frequency: E5, offset: 0.03, attack: 0.004, decay: 0.1, peak: 0.045 },
      { kind: "tone", waveform: "sine", frequency: E5 * 2, offset: 0.03, attack: 0.004, decay: 0.05, peak: 0.008 },
      { kind: "tone", waveform: "sine", frequency: B4, offset: 0.11, attack: 0.004, decay: 0.16, peak: 0.04 },
      { kind: "tone", waveform: "sine", frequency: B4 * 2, offset: 0.11, attack: 0.004, decay: 0.07, peak: 0.007 },
    ],
    space: 0.1,
  },
  /** A brief papery flick that crosses the stereo field, with a rising glass tick. */
  navigate: {
    masterGain: 0.88,
    layers: [
      noise("lowpass", 1800, 0.7, 0.07, 0.11, { attack: 0.006, pan: -0.35 }),
      noise("bandpass", 4000, 1.2, 0.06, 0.08, { attack: 0.004, offset: 0.035, pan: 0.35 }),
      ...glass(E6, { offset: 0.05, decay: 0.09, peak: 0.03, pan: 0.2 }),
    ],
    space: 0.12,
  },
};

const MECH: Record<SoundName, SoundRecipe> = {
  /** A resonant dry click with a tight thud. */
  tap: {
    masterGain: 0.28,
    layers: [
      noise("bandpass", 2200, 3, 0.012, 0.13),
      noise("lowpass", 900, 0.7, 0.02, 0.07),
      body(0.1, 0, 130, 60, 0.03),
    ],
  },
  /** A keycap top and bottom-out, slightly different every time. */
  type: {
    masterGain: 0.27,
    layers: [
      noise("bandpass", 3400, 2, 0.006, 0.1),
      noise("lowpass", 700, 0.7, 0.016, 0.09),
      body(0.06, 0, 120, 70, 0.03),
    ],
    variation: 30,
  },
  /** A ratchet detent: one precise metallic click. */
  select: {
    masterGain: 1.2,
    layers: [
      noise("bandpass", 4800, 5, 0.006, 0.13),
      { kind: "tone", waveform: "triangle", frequency: E7, attack: 0.001, decay: 0.008, peak: 0.02 },
    ],
  },
  /** A relay: click, then a tighter clack. */
  toggle: {
    masterGain: 0.31,
    layers: [
      noise("bandpass", 2000, 2, 0.01, 0.12),
      body(0.09, 0, 170, 65, 0.03),
      noise("bandpass", 3800, 2, 0.012, 0.1, { offset: 0.022 }),
      body(0.05, 0.022, 200, 80, 0.03),
    ],
  },
  /** A latch releasing: a rising sweep that ends on a click. */
  open: {
    masterGain: 0.4,
    layers: [
      noise("bandpass", 900, 1.5, 0.07, 0.09, { attack: 0.002, filterGlideTo: 2600, filterGlideTime: 0.06 }),
      { kind: "tone", waveform: "triangle", frequency: E4, glideTo: E5, glideTime: 0.06, attack: 0.002, decay: 0.07, peak: 0.04 },
      noise("bandpass", 3000, 2, 0.01, 0.1, { offset: 0.06 }),
      body(0.07, 0.06),
    ],
  },
  /** A latch closing: a falling sweep that ends on a thud. */
  close: {
    masterGain: 0.35,
    layers: [
      noise("bandpass", 2600, 1.5, 0.07, 0.09, { attack: 0.002, filterGlideTo: 700, filterGlideTime: 0.06 }),
      { kind: "tone", waveform: "triangle", frequency: E5, glideTo: E4, glideTime: 0.06, attack: 0.002, decay: 0.07, peak: 0.04 },
      noise("lowpass", 800, 0.7, 0.02, 0.08, { offset: 0.06 }),
      body(0.1, 0.06, 150, 55, 0.035),
    ],
  },
  /** Two precise notes and a click: done, no fanfare. */
  success: {
    masterGain: 0.92,
    layers: [
      noise("bandpass", 3500, 2, 0.008, 0.06),
      { kind: "tone", waveform: "triangle", frequency: A5, attack: 0.002, decay: 0.09, peak: 0.045 },
      { kind: "tone", waveform: "triangle", frequency: E6, offset: 0.06, attack: 0.002, decay: 0.14, peak: 0.05 },
    ],
  },
  /** A low knock and two short descending tones. */
  error: {
    masterGain: 0.36,
    layers: [
      noise("bandpass", 600, 1, 0.03, 0.12),
      body(0.12, 0, 130, 50),
      { kind: "tone", waveform: "triangle", frequency: E5, offset: 0.03, attack: 0.003, decay: 0.08, peak: 0.04 },
      { kind: "tone", waveform: "triangle", frequency: B4, offset: 0.1, attack: 0.003, decay: 0.12, peak: 0.035 },
    ],
  },
  /** A slider travelling left to right that stops on a click. */
  navigate: {
    masterGain: 1.3,
    layers: [
      noise("bandpass", 700, 1.5, 0.05, 0.1, { attack: 0.002, filterGlideTo: 1600, filterGlideTime: 0.05, pan: -0.4 }),
      noise("bandpass", 1600, 1.5, 0.05, 0.1, { attack: 0.002, offset: 0.04, filterGlideTo: 3200, filterGlideTime: 0.05, pan: 0.4 }),
      noise("bandpass", 4000, 2, 0.008, 0.07, { offset: 0.09, pan: 0.4 }),
    ],
  },
};

export const THEMES: Record<ThemeName, Record<SoundName, SoundRecipe>> = {
  default: DEFAULT,
  mech: MECH,
};
