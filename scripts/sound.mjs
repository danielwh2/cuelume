// Renders cuelume's cues offline, for review, level matching and the Claude Code plugin's WAVs.
// Dev only: never published. Reads the built recipes, so run `npm run build` first.
//
//   node scripts/sound.mjs levels [--write]   each cue's perceived level against default; --write sets masterGain
//   node scripts/sound.mjs review <theme> [dir]  one WAV per cue: subtle, normal, strong, then three quick repeats
//   node scripts/sound.mjs plugin              claude-code/sounds/<theme>/{ready,attention}.wav
//
// Web Audio's half of src/audio/render.ts and output.ts, done by hand: the same envelopes, glides, RBJ
// biquads (Web Audio's formulas), room, output gain and subsonic cut. Which layers play, and every
// constant, come from the built engine. It skips the limiter and the per-play strike, so a cue renders
// the same every time. Noise is seeded.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url);
export const { THEMES } = await import(new URL("dist/sounds/themes.js", ROOT));
const { shapeFor } = await import(new URL("dist/sounds/context.js", ROOT));
const { FLAT_Q } = await import(new URL("dist/sounds/layers.js", ROOT));
const { layersFor, SOURCE_STOP_PADDING: PAD } = await import(new URL("dist/audio/render.js", ROOT));
const { OUTPUT_GAIN, SUBSONIC_HZ, ROOM_SECONDS, ROOM_PREDELAY, ROOM_LOWPASS, ROOM_DECAY_DB, ROOM_SEND } = await import(
  new URL("dist/audio/output.js", ROOT)
);

export const SR = 48000;

/** A small seeded generator (mulberry32), so a render is the same every run. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
const seedOf = (text) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

// Web Audio's exponentialRamp: v0 * (v1/v0)^((t-t0)/(t1-t0))
const expAt = (v0, v1, t0, t1, t) => (t <= t0 ? v0 : t >= t1 ? v1 : v0 * Math.pow(v1 / v0, (t - t0) / (t1 - t0)));
const envAt = (l, t) => (t < 0 ? 0 : t < l.attack ? (l.peak * t) / l.attack : expAt(l.peak, 1e-4, l.attack, l.attack + l.decay, t));
const pitchAt = (l, from, t) => (l.glideTo === undefined ? from : expAt(from, l.glideTo, 0, l.glideTime ?? l.attack + l.decay, t));

function biquad(type, f, q) {
  const w = (2 * Math.PI * Math.min(f, SR / 2 - 1)) / SR, c = Math.cos(w), s = Math.sin(w);
  if (type === "bandpass") {
    const a = s / (2 * q), a0 = 1 + a;
    return [a / a0, 0, -a / a0, (-2 * c) / a0, (1 - a) / a0];
  }
  const a = s / (2 * Math.pow(10, q / 20)); // a lowpass or highpass Q is in dB
  const b = type === "lowpass" ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const a0 = 1 + a;
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * c) / a0, (1 - a) / a0];
}

function filter(x, k) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = k[0] * x[i] + k[1] * x1 + k[2] * x2 - k[3] * y1 - k[4] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

function addLayer(out, l, rand) {
  const start = Math.round((l.offset ?? 0) * SR), n = Math.round((l.attack + l.decay + PAD) * SR);
  const from = l.kind === "tone" ? l.frequency : l.filterFrequency;
  let phase = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0, k = null;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / SR, g = envAt(l, t);
    if (l.kind === "tone") {
      phase += (2 * Math.PI * pitchAt(l, from, t)) / SR;
      out[start + i] += g * Math.sin(phase);
    } else {
      if (i % 32 === 0) k = biquad(l.filterType, pitchAt(l, from, t), l.filterQ ?? 1);
      const x = rand() * 2 - 1, y = k[0] * x + k[1] * x1 + k[2] * x2 - k[3] * y1 - k[4] * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; out[start + i] += g * y;
    }
  }
}

/** The engine's room for one channel: noise dying ROOM_DECAY_DB over ROOM_SECONDS, at unit energy, through the walls. */
function roomFor(channel) {
  const rand = random(1000 + channel), n = Math.floor(ROOM_SECONDS * SR), fall = (ROOM_DECAY_DB / 20) * Math.LN10, d = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    d[i] = t < ROOM_PREDELAY ? 0 : (rand() * 2 - 1) * Math.exp((-fall * t) / ROOM_SECONDS);
    energy += d[i] * d[i];
  }
  for (let i = 0; i < n; i++) d[i] /= Math.sqrt(energy);
  return filter(d, biquad("lowpass", ROOM_LOWPASS, FLAT_Q));
}
const ROOMS = [roomFor(0), roomFor(1)];

function convolve(x, h) {
  let n = 1;
  while (n < x.length + h.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(x); br.set(h); fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i], im = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r; ai[i] = -im;
  }
  fft(ar, ai);
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = ar[i] / n;
  return y;
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const c = Math.cos(a * k), s = Math.sin(a * k), u = i + k, v = u + len / 2;
      const tr = re[v] * c - im[v] * s, ti = re[v] * s + im[v] * c;
      re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
    }
  }
}

/**
 * One play of `cue` in `theme`, one channel, as the engine plays it: `part` "both" is what `play()` does,
 * the release RELEASE_GAP after the press; `step` is the place in the cue's walk.
 */
export function render(theme, cue, { emphasis = "normal", part = "both", step = 0, channel = 0, seed = 0 } = {}) {
  const recipe = THEMES[theme][cue];
  // no `vary`, so no strike; no context and no recent play, so only the emphasis shapes it
  const shape = shapeFor(cue, {}, emphasis, Infinity);
  const layers = layersFor({ recipe: { ...recipe, vary: undefined }, emphasis, shape, step }, part);
  if (layers.length === 0) return new Float64Array(0);
  const end = Math.max(...layers.map((l) => l.offset + l.attack + l.decay + PAD)) + ROOM_SECONDS + 0.05;
  const dry = new Float64Array(Math.ceil(end * SR));
  const rand = random(seedOf(`${theme}.${cue}.${emphasis}.${part}.${seed}`));
  for (const l of layers) addLayer(dry, l, rand);
  const g = recipe.masterGain * OUTPUT_GAIN, send = ROOM_SEND * (recipe.room ?? 1);
  const wet = convolve(dry, ROOMS[channel]);
  const out = new Float64Array(dry.length);
  for (let i = 0; i < out.length; i++) out[i] = (dry[i] + wet[i] * send) * g;
  return filter(out, biquad("highpass", SUBSONIC_HZ, FLAT_Q));
}

export const stereo = (theme, cue, options = {}) => [0, 1].map((channel) => render(theme, cue, { ...options, channel }));

/** BS.1770's K-weighting at 48 kHz: a high shelf for the head, then a highpass for how little the ear hears low. */
const K_SHELF = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
const K_HIGHPASS = [1, -2, 1, -1.99004745483398, 0.99007225036621];
/** How long the ear sums a short sound into one loudness. */
const LOUDNESS_WINDOW = 0.1;

/** Perceived loudness: the loudest 100 ms, K-weighted, in LUFS. */
export function loudness(x) {
  const k = filter(filter(x, K_SHELF), K_HIGHPASS), w = Math.round(LOUDNESS_WINDOW * SR);
  let sum = 0, best = 0;
  for (let i = 0; i < k.length; i++) {
    sum += k[i] * k[i];
    if (i >= w) sum -= k[i - w] * k[i - w];
    if (sum > best) best = sum;
  }
  return -0.691 + 10 * Math.log10(best / w + 1e-20);
}

/** A cue's level: its loudness averaged over a few takes, since one take of noise can sit 2 dB off. */
export function levelOf(theme, cue, takes = 8) {
  const power = Array.from({ length: takes }, (_, seed) => 10 ** (loudness(render(theme, cue, { seed })) / 10));
  return 10 * Math.log10(power.reduce((a, b) => a + b) / takes);
}

export function wav(path, chunks, gap = 0.35) {
  // a chunk is mono (Float64Array) or stereo ([left, right]); the file is 16-bit stereo
  const st = chunks.map((c) => (Array.isArray(c) ? c : [c, c]));
  const len = st.reduce((a, [l]) => a + l.length + Math.round(gap * SR), 0), buf = Buffer.alloc(44 + len * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + len * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(len * 4, 40);
  const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  let o = 44;
  for (const [l, r] of st) {
    for (let i = 0; i < l.length; i++) { buf.writeInt16LE(q(l[i]), o); buf.writeInt16LE(q(r[i]), o + 2); o += 4; }
    o += Math.round(gap * SR) * 4;
  }
  writeFileSync(path, buf);
}

/** Plays at `times` (seconds), each `[theme, cue, options]`, mixed into one stereo take. */
function mix(plays, seconds) {
  const out = [new Float64Array(Math.ceil(seconds * SR)), new Float64Array(Math.ceil(seconds * SR))];
  for (const [t, theme, cue, options] of plays) {
    const [l, r] = stereo(theme, cue, options), s = Math.round(t * SR);
    for (let i = 0; i < l.length && s + i < out[0].length; i++) { out[0][s + i] += l[i]; out[1][s + i] += r[i]; }
  }
  return out;
}

/** The source file that holds each theme's recipes. */
const SOURCE = (theme) => new URL(`src/sounds/${theme === "default" ? "recipes" : theme}.ts`, ROOT);

const [command, ...args] = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href ? process.argv.slice(2) : [];
if (command === "levels") {
  for (const theme of Object.keys(THEMES).filter((t) => t !== "default")) {
    let source = readFileSync(SOURCE(theme), "utf8");
    const rows = [];
    for (const cue of Object.keys(THEMES.default)) {
      const off = levelOf("default", cue) - levelOf(theme, cue);
      const gain = +(THEMES[theme][cue].masterGain * 10 ** (off / 20)).toPrecision(3);
      rows.push(`${cue} ${off >= 0 ? "+" : ""}${off.toFixed(1)} dB → ${gain}`);
      source = source.replace(new RegExp(`(\\n  ${cue}: \\{\\n    masterGain: )[\\d.]+,`), `$1${gain},`);
    }
    console.log(`${theme}: ${rows.join(", ")}`);
    if (args.includes("--write")) writeFileSync(SOURCE(theme), source);
  }
} else if (command === "review") {
  const [theme, dir = "review"] = args;
  if (!THEMES[theme]) throw new Error(`no theme ${theme}`);
  mkdirSync(dir, { recursive: true });
  for (const cue of Object.keys(THEMES[theme])) {
    const repeats = mix([0, 1, 2].map((step) => [0.05 + step * 0.33, theme, cue, { step }]), 2.4);
    wav(`${dir}/${theme}-${cue}.wav`, [...["subtle", "normal", "strong"].map((emphasis) => stereo(theme, cue, { emphasis })), repeats], 0.5);
  }
  console.log(`wrote ${Object.keys(THEMES[theme]).length} cues to ${dir}/`);
} else if (command === "plugin") {
  for (const theme of Object.keys(THEMES)) {
    mkdirSync(new URL(`claude-code/sounds/${theme}`, ROOT), { recursive: true });
    for (const cue of ["ready", "attention"]) wav(new URL(`claude-code/sounds/${theme}/${cue}.wav`, ROOT), [stereo(theme, cue)], 0);
  }
  console.log("wrote the plugin's ready and attention for every theme");
} else if (command) {
  throw new Error(`unknown command ${command}`);
}
