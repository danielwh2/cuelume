import assert from "node:assert/strict";
import test from "node:test";

const originals = new Map();

function setGlobal(name, value) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

function restoreGlobals() {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  originals.clear();
}

const audioParam = () => ({
  value: 0,
  ramps: [],
  rampTimes: [],
  setValueAtTime(value, time) {
    this.value = value;
    this.setAt = time;
  },
  exponentialRampToValueAtTime(value, time) {
    this.ramps.push(value);
    this.rampTimes.push(time);
  },
  linearRampToValueAtTime(value, time) {
    this.swell = value;
    this.swellAt = time;
  },
  cancelScheduledValues() {
    this.ramps.length = 0;
    this.rampTimes.length = 0;
  },
});

function waveShaper(node) {
  return Object.assign(node, { curve: null, oversample: "none" });
}

// A Web Audio stand-in that records when each source starts and stops, and every pitch that glides.
function recordingContext() {
  const log = { sources: [], pitched: [], delays: [] };
  class Node {
    connect(destination) {
      return destination;
    }
    disconnect() {}
  }
  const source = (extra) => {
    const node = Object.assign(new Node(), extra, {
      start(at) {
        node.at = at;
      },
      stop(at) {
        node.end = at;
      },
    });
    log.sources.push(node);
    return node;
  };
  class Context {
    state = "running";
    currentTime = 0;
    sampleRate = 1;
    destination = new Node();
    createGain() {
      return Object.assign(new Node(), { gain: audioParam() });
    }
    createConvolver() {
      return Object.assign(new Node(), { buffer: null, normalize: true });
    }
    createWaveShaper() {
      return waveShaper(new Node());
    }
    createDelay() {
      return Object.assign(new Node(), { delayTime: audioParam() });
    }
    createBuffer() {
      return { getChannelData: () => new Float32Array(1) };
    }
    createOscillator() {
      const frequency = audioParam();
      log.pitched.push(frequency);
      return source({ frequency, detune: audioParam() });
    }
    createBufferSource() {
      return source({ buffer: null });
    }
    createBiquadFilter() {
      const frequency = audioParam();
      log.pitched.push(frequency);
      return Object.assign(new Node(), { frequency, Q: audioParam() });
    }
  }
  return { Context, log };
}

// How far one play can move a layer's pitch or filter from its recipe: the strike's pitch, and for
// noise the strike's force too (a harder strike is brighter), or for a tone a little mode jitter.
const MODE_JITTER = 0.005;
const spread = (layer, vary) =>
  vary ? (1 + vary.pitch) * (1 + (layer.kind === "noise" ? vary.level : MODE_JITTER)) - 1 : 0;

const CANONICAL = [
  "tap", "type", "select", "toggle", "open", "close", "success", "error", "navigate",
  "warning", "loading", "ready", "attention", "count",
];

test("palette is the fourteen canonical cues, the original nine first", async () => {
  const { setVolume, sounds } = await import("../dist/index.js");
  assert.deepEqual(sounds, CANONICAL);
  assert.equal(typeof setVolume, "function");
});

test("deprecated names resolve to their documented canonical cue", async () => {
  const { resolveSound } = await import("../dist/sounds/recipes.js");
  const migration = {
    chime: "success",
    sparkle: "success",
    droplet: "close",
    bloom: "open",
    whisper: "select",
    tick: "select",
    press: "tap",
    release: "tap",
    toggle: "toggle",
    success: "success",
    error: "error",
    page: "navigate",
    loading: "loading",
    ready: "ready",
    pulse: "tap",
    scan: "select",
    arrival: "navigate",
  };
  for (const [name, cue] of Object.entries(migration)) assert.equal(resolveSound(name), cue, name);
  for (const cue of CANONICAL) assert.equal(resolveSound(cue), cue);
  for (const invalid of ["toString", "__proto__", "", null, 1]) assert.equal(resolveSound(invalid), null);
});

test("context shapes cues within bounds and leaves missing context canonical", async () => {
  const { shapeFor, layerFactors, resolveEmphasis, arrangement, contextFrom } = await import("../dist/sounds/context.js");
  const { RECIPES } = await import("../dist/sounds/recipes.js");
  const { THEMES } = await import("../dist/sounds/themes.js");
  const identity = { pitch: 1, level: 1, length: 1, bright: 1, tail: 1, sweep: 1, time: 1 };
  const SLOW = 10_000;

  for (const cue of CANONICAL) assert.deepEqual(shapeFor(cue, {}, "normal", SLOW), identity, cue);
  // cues that don't listen for a context ignore it
  assert.deepEqual(shapeFor("success", { key: "enter", input: "touch", direction: 1, duration: 1600 }, "normal", 10), identity);

  assert.equal(resolveEmphasis("strong"), "strong");
  for (const invalid of ["loud", "toString", undefined, 2]) assert.equal(resolveEmphasis(invalid), "normal");
  // each emphasis is its own arrangement: strong adds a layer, subtle strips ornament
  let simpler = 0;
  for (const cue of CANONICAL) {
    const [few, base, more] = ["subtle", "normal", "strong"].map((e) => arrangement(RECIPES[cue].layers, e));
    assert.equal(base.length, RECIPES[cue].layers.filter((l) => l.from !== "strong").length, cue);
    assert.ok(more.length > base.length && few.length <= base.length, cue);
    if (few.length < base.length) simpler++;
  }
  assert.ok(simpler >= CANONICAL.length - 1); // toggle has no ornament to strip

  const [subtle, normal, strong] = ["subtle", "normal", "strong"].map((e) => shapeFor("success", {}, e, SLOW));
  assert.ok(subtle.level < normal.level && normal.level < strong.level);
  assert.ok(subtle.length < normal.length && normal.length < strong.length);
  assert.ok(subtle.bright < normal.bright && normal.bright < strong.bright);

  // type: cadence lightens and drops the key return; key roles order by size
  const fast = shapeFor("type", {}, "normal", 50);
  assert.ok(fast.level < 1 && fast.length < 1 && fast.tail < 0.5);
  assert.ok(shapeFor("type", {}, "normal", 150).tail > fast.tail);
  const pitch = (key) => shapeFor("type", { key }, "normal", SLOW).pitch;
  assert.ok(pitch("enter") < pitch("space") && pitch("space") < pitch("delete") && pitch("delete") < pitch("printable"));

  // select: direction; tap: input method
  assert.ok(shapeFor("select", { direction: 1 }, "normal", SLOW).pitch > 1);
  assert.ok(shapeFor("select", { direction: -1 }, "normal", SLOW).pitch < 1);
  assert.ok(shapeFor("tap", { input: "touch" }, "normal", SLOW).bright < 1);
  assert.ok(shapeFor("tap", { input: "keyboard" }, "normal", SLOW).pitch < 1);
  // count: duration scales time against its 800 ms original
  assert.equal(shapeFor("count", { duration: 1600 }, "normal", SLOW).time, 2);
  assert.equal(shapeFor("count", { duration: 400 }, "strong", SLOW).time, 0.5);

  // every context, emphasis, and cadence stays bounded on every layer
  const contexts = [{}, { key: "enter" }, { key: "space" }, { key: "delete" }, { input: "touch" }, { input: "pen" },
    { input: "keyboard" }, { direction: 1 }, { direction: -1 }, { duration: 300 }, { duration: 2000 }];
  for (const cue of CANONICAL) {
    for (const context of contexts) {
      for (const emphasis of ["subtle", "normal", "strong"]) {
        for (const since of [0, 60, 120, SLOW]) {
          for (const layer of Object.values(THEMES).flatMap((theme) => theme[cue].layers)) {
            const f = layerFactors(layer, shapeFor(cue, context, emphasis, since));
            assert.ok(f.pitch >= 0.75 && f.pitch <= 1.25 && f.gain >= 0 && f.gain <= 1.5);
            assert.ok(f.length >= 0.6 && f.length <= 1.6);
          }
        }
      }
    }
  }

  // play() options map onto the same context bindings produce; junk is dropped
  assert.deepEqual(contextFrom({ direction: "back", key: "delete", input: "pen" }), { direction: -1, key: "delete", input: "pen" });
  assert.deepEqual(contextFrom({ direction: "forward" }), { direction: 1 });
  // duration: finite numbers clamp to 300–2000 ms
  assert.deepEqual(contextFrom({ duration: 900 }), { duration: 900 });
  assert.deepEqual(contextFrom({ duration: 100 }), { duration: 300 });
  assert.deepEqual(contextFrom({ duration: 0 }), { duration: 300 });
  assert.deepEqual(contextFrom({ duration: 5000 }), { duration: 2000 });
  for (const junk of [undefined, null, {}, { direction: "up", key: "toString", input: 3 }, { direction: 1 }, { direction: "BACK" },
    { duration: "900" }, { duration: Number.NaN }, { duration: Infinity }]) {
    assert.deepEqual(contextFrom(junk), {}, JSON.stringify(junk));
  }
  // navigate, toggle and count going back play their glides reversed; nothing else does
  for (const cue of ["navigate", "toggle", "count"]) {
    assert.equal(shapeFor(cue, { direction: -1 }, "normal", SLOW).sweep, -1, cue);
    assert.equal(shapeFor(cue, { direction: 1 }, "normal", SLOW).sweep, 1, cue);
  }
  assert.equal(shapeFor("select", { direction: -1 }, "normal", SLOW).sweep, 1);
});

test("every theme carries the same cues, each arranged for every emphasis", async () => {
  const { themes, sounds } = await import("../dist/index.js");
  const { THEMES } = await import("../dist/sounds/themes.js");
  const { arrangement } = await import("../dist/sounds/context.js");
  assert.deepEqual(themes, ["default", "mech", "bubble", "press"]);
  for (const theme of themes) {
    assert.deepEqual(Object.keys(THEMES[theme]), [...sounds], theme);
    for (const cue of sounds) {
      const layers = THEMES[theme][cue].layers;
      const [few, base, more] = ["subtle", "normal", "strong"].map((e) => arrangement(layers, e));
      assert.ok(few.length >= 1 && few.length <= base.length && more.length > base.length, `${theme} ${cue}`);
    }
  }
  // each theme is its own material, not another renamed
  for (const cue of sounds) {
    const [base, mech, bubble] = ["default", "mech", "bubble"].map((theme) => THEMES[theme][cue].layers);
    assert.notDeepEqual(mech, base, cue);
    assert.notDeepEqual(bubble, base, cue);
    assert.notDeepEqual(bubble, mech, cue);
  }
});

test("every layer keeps the register: nothing above 5 kHz, sines only, and outside bubble no tone slides", async () => {
  const { THEMES } = await import("../dist/sounds/themes.js");
  for (const [theme, cues] of Object.entries(THEMES)) {
    for (const [cue, recipe] of Object.entries(cues)) {
      // a room is for results that land
      if (recipe.room) assert.ok(cue === "success" || cue === "ready", `${theme} ${cue} rings into the room`);
      for (const layer of [...recipe.layers, ...(recipe.release ?? [])]) {
        const centre = Math.max(layer.kind === "tone" ? layer.frequency : layer.filterFrequency, layer.glideTo ?? 0);
        assert.ok(centre <= 5000, `${theme} ${cue}: ${centre} Hz`);
        if (layer.kind === "tone") {
          assert.equal(layer.waveform, "sine", `${theme} ${cue}: ${layer.waveform} tone`);
          // outside bubble a glide is a knock's body, the pitch drop of a struck surface, never a slide you hear
          if (theme !== "bubble" && layer.glideTo !== undefined) {
            assert.ok(layer.glideTo < layer.frequency && (layer.glideTime ?? layer.attack + layer.decay) <= 0.025, `${theme} ${cue}: a tone that slides`);
          }
        }
      }
    }
  }
  // bubble is made of bloops: every cue has a tone that glides
  for (const [cue, recipe] of Object.entries(THEMES.bubble)) {
    assert.ok(recipe.layers.some((layer) => layer.kind === "tone" && layer.glideTo !== undefined), `bubble ${cue} has a bloop`);
  }
});

test("a struck note's higher modes die sooner, and none rises past the register", async () => {
  const { struck, BAR, MALLET } = await import("../dist/sounds/layers.js");
  for (const material of [BAR, MALLET]) {
    for (const frequency of [220, 880, 1318.51]) {
      const modes = struck(frequency, 0.4, 0.02, material);
      assert.equal(modes[0].frequency, frequency);
      assert.ok(modes.every((mode) => mode.frequency <= 5000), `${frequency} Hz stays under 5 kHz`);
      for (let i = 1; i < modes.length; i++) {
        assert.ok(modes[i].frequency > modes[i - 1].frequency && modes[i].decay < modes[i - 1].decay, `${frequency} Hz mode ${i} dies sooner`);
        assert.equal(modes[i].from, "normal", "upper modes are ornament");
      }
    }
  }
  // a strong-only note keeps every mode strong-only
  assert.ok(struck(220, 0.4, 0.02, BAR, { from: "strong" }).every((mode) => mode.from === "strong"));
});

test("a press strikes at once and so does its release; only notes walk, and only where a walk means nothing", async () => {
  const { THEMES } = await import("../dist/sounds/themes.js");
  const OUTCOMES = ["success", "error", "warning", "ready", "attention", "loading", "count"];
  for (const [theme, cues] of Object.entries(THEMES)) {
    for (const [cue, recipe] of Object.entries(cues)) {
      for (const layer of [...recipe.layers, ...(recipe.release ?? [])]) assert.equal(layer.offset ?? 0, 0, `${theme} ${cue} strikes twice`);
      // nothing is pressed for an outcome, so nothing lets go
      if (OUTCOMES.includes(cue)) assert.equal(recipe.release, undefined, `${theme} ${cue} lets go`);
      if (recipe.release) assert.ok(recipe.release.length > 0, `${theme} ${cue} has an empty release`);
      if (!recipe.walk) continue;
      // a walk moves notes, so it needs one, and never where pitch already means something
      assert.ok(!OUTCOMES.includes(cue) && cue !== "select", `${theme} ${cue} walks`);
      assert.ok(recipe.layers.some((layer) => layer.note), `${theme} ${cue} walks with no note`);
      assert.equal(recipe.walk[0], 0, `${theme} ${cue}'s walk starts on its note`);
    }
  }
});

test("outcome cues keep their meaning in one strike, in every theme", async () => {
  const { THEMES } = await import("../dist/sounds/themes.js");
  // the tones every emphasis plays, at the pitch each settles on
  const core = (recipe) => recipe.layers.filter((layer) => !layer.from && layer.kind === "tone");
  const settled = (layer) => layer.glideTo ?? layer.frequency;
  const lowest = (recipe) => Math.min(...core(recipe).map((layer) => layer.frequency));
  // a chord: two pitches that are not the same note in another octave
  const chord = (recipe) => {
    const pitches = core(recipe).map(settled);
    return pitches.some((a) => pitches.some((b) => {
      const octaves = Math.abs(Math.log2(a / b));
      return Math.abs(octaves - Math.round(octaves)) > 0.05;
    }));
  };
  const glides = (recipe) => core(recipe).filter((layer) => layer.glideTo !== undefined).map((layer) => layer.glideTo / layer.frequency);

  for (const [theme, cues] of Object.entries(THEMES)) {
    const { success, error, warning, attention, ready } = cues;
    // register carries the meaning: error sits lowest, success above warning, attention at or above success
    assert.ok(lowest(error) < lowest(warning), `${theme} error below warning`);
    assert.ok(lowest(warning) < lowest(success), `${theme} warning below success`);
    assert.ok(lowest(attention) >= lowest(success), `${theme} attention at or above success`);
    assert.ok(lowest(ready) < lowest(success), `${theme} ready below success`);
    // randomness never blurs it: outcomes and select's direction keep their pitch
    for (const cue of ["success", "error", "warning", "attention"]) assert.equal(cues[cue].vary?.pitch ?? 0, 0, `${theme} ${cue} keeps its pitch`);
    assert.ok((cues.select.vary?.pitch ?? 0) < 0.05, `${theme} select's direction outweighs its randomness`);
    if (theme === "bubble") {
      // bubble says it with one glide: success and attention rise, error sinks, warning stays level
      assert.ok(glides(success).length && glides(success).every((r) => r > 1), "bubble success rises");
      assert.ok(glides(attention).length && glides(attention).every((r) => r > 1), "bubble attention rises");
      assert.ok(glides(error).length && glides(error).every((r) => r < 1), "bubble error sinks");
      assert.ok(glides(warning).every((r) => Math.abs(r - 1) < 0.15), "bubble warning stays level");
    } else {
      // the others strike a chord at once
      for (const cue of ["success", "error", "warning"]) assert.ok(chord(cues[cue]), `${theme} ${cue} is a chord`);
    }
  }
});

test("count follows its duration and falls going back, in every theme and emphasis", async (context) => {
  context.after(restoreGlobals);
  // no per-play variation, so two plays can be compared exactly
  context.mock.method(Math, "random", () => 0.5);
  const { Context, log } = recordingContext();
  setGlobal("setTimeout", (callback, delay) => {
    log.delays.push(delay);
    return 0;
  });
  setGlobal("window", { AudioContext: Context });
  const { play, setTheme } = await import(`../dist/audio/engine.js?count=${Date.now()}`);
  play("tap"); // builds the shared output and room, so what follows logs one pitched param per layer
  const { THEMES } = await import("../dist/sounds/themes.js");
  const { arrangement } = await import("../dist/sounds/context.js");

  const played = (cue, options) => {
    const [sources, pitched] = [log.sources.length, log.pitched.length];
    play(cue, options);
    return { sources: log.sources.slice(sources), pitched: log.pitched.slice(pitched) };
  };
  const starts = (options, cue = "count") => played(cue, options).sources.map((source) => source.at);
  const glides = (cue, options) =>
    played(cue, options).pitched.filter((param) => param.ramps.length > 0).map((param) => param.ramps[0] - param.value);
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  for (const theme of Object.keys(THEMES)) {
    setTheme(theme);
    // duration moves every layer's start in proportion; only stretch layers change length
    const layers = arrangement(THEMES[theme].count.layers, "normal");
    const [short, long] = [300, 2000].map((duration) => played("count", { duration }));
    assert.equal(short.sources.length, layers.length, theme);
    layers.forEach((layer, i) => {
      const offset = layer.offset ?? 0;
      const [s, l] = [short.sources[i], long.sources[i]];
      assert.ok(near(s.at, (offset * 300) / 800) && near(l.at, (offset * 2000) / 800), `${theme} layer ${i} starts in step`);
      // a stretch layer's sound and glide both last in proportion; everything else keeps its length
      const scale = layer.stretch ? 2000 / 300 : 1;
      assert.ok(near(l.end - l.at - 0.05, (s.end - s.at - 0.05) * scale), `${theme} layer ${i} length`);
      // one pitched param per layer, in layer order: a filter for noise, an oscillator for a tone
      const [sp, lp] = [short.pitched[i], long.pitched[i]];
      if (layer.glideTo !== undefined) {
        assert.ok(near(lp.rampTimes[0] - lp.setAt, (sp.rampTimes[0] - sp.setAt) * scale), `${theme} layer ${i} glide time`);
      }
    });
    // clamped to 300–2000 ms; anything that isn't a finite number plays the 800 ms original
    assert.deepEqual(starts({ duration: 100 }), starts({ duration: 300 }), theme);
    assert.deepEqual(starts({ duration: -5 }), starts({ duration: 300 }), theme);
    assert.deepEqual(starts({ duration: 60_000 }), starts({ duration: 2000 }), theme);
    for (const junk of ["900", Number.NaN, Infinity, null, undefined]) {
      assert.deepEqual(starts({ duration: junk }), starts(), `${theme} ${junk}`);
    }
    // other cues ignore it
    assert.deepEqual(starts({ duration: 2000 }, "success"), starts({}, "success"), theme);
    // the graph stays up until a stretched roll has landed and rung out
    play("count", { duration: 2000 });
    const lands = Math.max(...layers.map((layer) => layer.offset ?? 0)) * 2.5 * 1000;
    assert.ok(log.delays.at(-1) > lands + 50, `${theme} cleanup`);

    // going back plays every glide reversed, so counting down falls, at every emphasis
    for (const emphasis of ["subtle", "normal", "strong"]) {
      const [up, down] = [glides("count", { emphasis }), glides("count", { emphasis, direction: "back" })];
      assert.ok(up.length > 0 && up.every((d) => d > 0), `${theme} ${emphasis} count rises`);
      assert.ok(down.length === up.length && down.every((d) => d < 0), `${theme} ${emphasis} count falls going back`);
    }
  }
  // bubble's toggle and navigate glide too, so going back sinks them
  setTheme("bubble");
  for (const cue of ["toggle", "navigate"]) {
    const [up, down] = [glides(cue, {}), glides(cue, { direction: "back" })];
    assert.ok(up.length > 0 && up.every((d) => d > 0), `bubble ${cue} rises`);
    assert.ok(down.length === up.length && down.every((d) => d < 0), `bubble ${cue} sinks going back`);
  }
  setTheme("default");
});

test("a per-play theme plays that theme once and leaves the active one", async (context) => {
  context.after(restoreGlobals);
  const { Context, log } = recordingContext();
  setGlobal("setTimeout", () => 0);
  setGlobal("window", { AudioContext: Context });
  const { play, setTheme } = await import(`../dist/audio/engine.js?theme=${Date.now()}`);
  play("tap"); // builds the shared output and room, so what follows logs only the cue's own params
  const { THEMES } = await import("../dist/sounds/themes.js");

  // tap's first layer tells the themes apart: a noise tick in default and mech, a bloop in bubble
  const firstPitch = (options) => {
    const before = log.pitched.length;
    play("tap", options);
    return log.pitched[before].value;
  };
  const is = (theme, value) => {
    const { layers, vary } = THEMES[theme].tap;
    const base = layers[0].kind === "tone" ? layers[0].frequency : layers[0].filterFrequency;
    return Math.abs(value / base - 1) <= spread(layers[0], vary) + 1e-9;
  };

  assert.ok(is("default", firstPitch()));
  assert.ok(is("bubble", firstPitch({ theme: "bubble" })));
  assert.ok(is("default", firstPitch()), "the override lasts one play");
  setTheme("mech");
  assert.ok(is("default", firstPitch({ theme: "default" })));
  for (const junk of ["glass", "toString", "__proto__", "Bubble", 1, null]) {
    assert.ok(is("mech", firstPitch({ theme: junk })), String(junk));
  }
  assert.ok(is("mech", firstPitch()));
  setTheme("default");
});

test("a cue plays one voice at a time: a new play releases the last, other cues ring on", async (context) => {
  context.after(restoreGlobals);
  const { Context } = recordingContext();
  const gains = [];
  class Recording extends Context {
    currentTime = 5;
    createGain() {
      const gain = super.createGain();
      gains.push(gain);
      return gain;
    }
  }
  setGlobal("setTimeout", () => 0);
  setGlobal("window", { AudioContext: Recording });
  const { play } = await import(`../dist/audio/engine.js?voice=${Date.now()}`);
  const { THEMES } = await import("../dist/sounds/themes.js");

  // a play's master is the gain set straight to its recipe's level
  const master = (cue) => {
    const before = gains.length;
    play(cue);
    return gains.slice(before).find((gain) => gain.gain.value === THEMES.default[cue].masterGain);
  };
  const first = master("tap");
  const other = master("success");
  assert.equal(first.gain.ramps.length, 0, "another cue leaves tap ringing");
  const second = master("tap");
  // the last tap fades out quickly from where it is, and the new one plays in full
  assert.deepEqual(first.gain.ramps, [0.0001]);
  assert.equal(first.gain.setAt, 5);
  assert.ok(first.gain.rampTimes[0] > 5 && first.gain.rampTimes[0] <= 5.1);
  assert.equal(second.gain.ramps.length, 0);
  assert.equal(other.gain.ramps.length, 0);
});

test("a press lets go: play() releases 90 ms later, a binding splits the two, and quick repeats walk", async (context) => {
  context.after(restoreGlobals);
  context.mock.method(Math, "random", () => 0.5); // no per-play variation, so pitches compare exactly
  const { Context, log } = recordingContext();
  const gains = [];
  class Recording extends Context {
    createGain() {
      const gain = super.createGain();
      gains.push(gain);
      return gain;
    }
  }
  let clock = 0;
  setGlobal("performance", { now: () => clock });
  setGlobal("setTimeout", () => 0);
  setGlobal("window", { AudioContext: Recording });
  const { play, playInContext, press: pressCue, release, setTheme } = await import(`../dist/audio/engine.js?gesture=${Date.now()}`);
  const { THEMES } = await import("../dist/sounds/themes.js");
  const { arrangement } = await import("../dist/sounds/context.js");
  play("success"); // builds the shared output first
  setTheme("press");
  const { tap } = THEMES.press;
  const [pressed, released] = [tap.layers, tap.release].map((layers) => arrangement(layers, "normal").length);
  const sourcesOf = (action) => {
    const before = log.sources.length;
    action();
    return log.sources.slice(before);
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  // play(): the press now and the release 90 ms later, in one play
  clock += 5_000;
  const both = sourcesOf(() => play("tap"));
  assert.equal(both.length, pressed + released);
  assert.ok(both.slice(0, pressed).every((source) => source.at === 0));
  assert.ok(both.slice(pressed).every((source) => near(source.at, 0.09)));

  // a binding: the press alone, then its release the moment the gesture lifts; a second lift finds nothing
  clock += 5_000;
  const master = () => gains.findLast((gain) => gain.gain.value === tap.masterGain);
  assert.equal(sourcesOf(() => playInContext("tap", undefined, {}, "press")).length, pressed);
  const press = master();
  const lift = sourcesOf(() => playInContext("tap", undefined, {}, "release"));
  assert.equal(lift.length, released);
  assert.ok(lift.every((source) => source.at === 0));
  assert.equal(press.gain.ramps.length, 0, "a release rings with its press, it doesn't replace it");
  assert.equal(sourcesOf(() => playInContext("tap", undefined, {}, "release")).length, 0);

  // press() and release() are the same split, for custom controls
  clock += 5_000;
  assert.equal(sourcesOf(() => pressCue("tap", { emphasis: "strong" })).length, arrangement(tap.layers, "strong").length);
  assert.equal(sourcesOf(() => release("tap")).length, arrangement(tap.release, "strong").length, "a release keeps its press's emphasis");
  assert.equal(sourcesOf(() => release("tap")).length, 0);
  const { press: exported, release: exportedRelease } = await import("../dist/index.js");
  assert.equal(typeof exported, "function");
  assert.equal(typeof exportedRelease, "function");

  // a press that plays nothing still ends the one before it: nothing old is left to let go
  clock += 5_000;
  pressCue("tap");
  assert.equal(sourcesOf(() => pressCue("tap", { volume: 0 })).length, 0);
  assert.equal(sourcesOf(() => release("tap")).length, 0);

  // a binding names the gesture, so keys that overlap each let go of their own press
  clock += 5_000;
  const keyLift = arrangement(THEMES.press.type.release, "normal").length;
  playInContext("type", undefined, {}, "press", "KeyA");
  clock += 100;
  playInContext("type", undefined, {}, "press", "KeyS");
  assert.equal(sourcesOf(() => playInContext("type", undefined, {}, "release", "KeyA")).length, keyLift);
  assert.equal(sourcesOf(() => playInContext("type", undefined, {}, "release", "KeyS")).length, keyLift);
  assert.equal(sourcesOf(() => playInContext("type", undefined, {}, "release", "KeyS")).length, 0);

  // quick taps walk C, E, A and round again; a pause starts over
  const noteOf = () => sourcesOf(() => play("tap")).find((source) => source.frequency).frequency.value;
  clock += 5_000;
  const root = noteOf();
  const steps = [];
  for (let i = 0; i < 4; i++) {
    clock += 300;
    steps.push(Math.round(12 * Math.log2(noteOf() / root)));
  }
  assert.deepEqual(steps, tap.walk.slice(1).concat(tap.walk, tap.walk).slice(0, 4));
  clock += 1_500;
  assert.equal(noteOf(), root);

  // a cue with notes lets its last play go over 400 ms, so a walk overlaps
  clock += 300;
  const last = master();
  play("tap");
  assert.deepEqual(last.gain.ramps, [0.0001]);
  assert.ok(near(last.gain.rampTimes[0], 0.4));
  setTheme("default");
});

test("one strike per play: every layer shares it, harder is louder and brighter, and only cues with vary move", async (context) => {
  context.after(restoreGlobals);
  const { Context, log } = recordingContext();
  const gains = [];
  class Recording extends Context {
    createGain() {
      const gain = super.createGain();
      gains.push(gain);
      return gain;
    }
  }
  setGlobal("setTimeout", () => 0);
  setGlobal("window", { AudioContext: Recording });
  // plays a second apart, so a cue that walks stays on its first step
  let clock = 0;
  setGlobal("performance", { now: () => (clock += 2_000) });
  const { play } = await import(`../dist/audio/engine.js?strike=${Date.now()}`);
  const { THEMES } = await import("../dist/sounds/themes.js");
  const { arrangement } = await import("../dist/sounds/context.js");
  play("tap"); // builds the shared output and room first

  // how each layer of one play landed against its recipe: level, pitch or filter, and ring length
  const struck = (theme, cue) => {
    const [g, p] = [gains.length, log.pitched.length];
    play(cue, { theme });
    const layerGains = gains.slice(g + 2); // after the play's master and its room send
    const pitched = log.pitched.slice(p);
    return arrangement(THEMES[theme][cue].layers, "normal").map((layer, i) => ({
      layer,
      level: layerGains[i].gain.swell / layer.peak,
      pitch: pitched[i].value / (layer.kind === "tone" ? layer.frequency : layer.filterFrequency),
      ring: (layerGains[i].gain.rampTimes[0] - layer.attack) / layer.decay,
    }));
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  // press open varies in level only: no pitch, so a noise layer's filter moves with its level alone
  const { level: bound } = THEMES.press.open.vary;
  const forces = [];
  for (let i = 0; i < 30; i++) {
    const layers = struck("press", "open");
    const force = layers[0].level;
    forces.push(force);
    assert.ok(Math.abs(force - 1) <= bound + 1e-9);
    for (const { layer, level, pitch, ring } of layers) {
      assert.ok(near(level, force), "every layer is struck as hard");
      if (layer.kind === "noise") assert.ok(near(pitch, force), "a harder strike is brighter");
      else assert.ok(Math.abs(pitch - 1) <= 0.005 + 1e-9, "a tone's mode moves a hair");
      assert.ok(Math.abs(ring - 1) <= 0.1 + 1e-9, "each layer rings a little longer or shorter");
    }
  }
  assert.ok(new Set(forces).size > 25, "no two strikes match");

  // default success has no vary: every play is the recipe exactly
  for (let i = 0; i < 3; i++) {
    for (const { level, pitch, ring } of struck("default", "success")) assert.ok(near(level, 1) && near(pitch, 1) && near(ring, 1));
  }
});

test("play waits for user activation before creating AudioContext", async (context) => {
  context.after(restoreGlobals);
  let constructions = 0;
  const userActivation = { hasBeenActive: false };

  class ThrowingContext {
    constructor() {
      constructions++;
      throw new Error("blocked");
    }
  }

  setGlobal("navigator", { userActivation });
  setGlobal("window", { AudioContext: ThrowingContext });
  const { play } = await import(`../dist/audio/engine.js?activation=${Date.now()}`);

  play("tap");
  assert.equal(constructions, 0);

  userActivation.hasBeenActive = true;
  play("tap");
  assert.equal(constructions, 1);
});

test("invalid names and AudioContext failures are silent", async (context) => {
  context.after(restoreGlobals);
  let constructions = 0;

  class ThrowingContext {
    constructor() {
      constructions++;
      throw new Error("blocked");
    }
  }

  setGlobal("window", { AudioContext: ThrowingContext });
  const { play, setEnabled } = await import(`../dist/audio/engine.js?failures=${Date.now()}`);

  assert.doesNotThrow(() => play("toString"));
  assert.equal(constructions, 0);
  setEnabled(false);
  assert.doesNotThrow(() => play("tap"));
  assert.equal(constructions, 0);
  setEnabled(true);
  assert.doesNotThrow(() => play("tap"));
  assert.equal(constructions, 1);

  let renders = 0;
  class RejectedContext {
    state = "suspended";
    resume() {
      return Promise.reject(new Error("blocked"));
    }
    createGain() {
      renders++;
    }
  }

  setGlobal("window", { AudioContext: RejectedContext });
  const rejected = await import(`../dist/audio/engine.js?rejected=${Date.now()}`);
  assert.doesNotThrow(() => rejected.play("tap"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renders, 0);

  let finishResume = () => {};
  class DeferredContext {
    state = "suspended";
    destination = {};
    resume() {
      return new Promise((resolve) => {
        finishResume = () => {
          this.state = "running";
          resolve();
        };
      });
    }
    createGain() {
      renders++;
      throw new Error("rendered while disabled");
    }
  }

  setGlobal("window", { AudioContext: DeferredContext });
  const deferred = await import(`../dist/audio/engine.js?deferred=${Date.now()}`);
  deferred.play("tap");
  deferred.setEnabled(false);
  finishResume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renders, 0);

});

test("volume is clamped and one boosted output bus is reused", async (context) => {
  context.after(restoreGlobals);
  const gains = [];
  const clips = [];

  class AudioNodeStub {
    constructor(name) {
      this.name = name;
      this.connections = [];
    }
    connect(destination) {
      this.connections.push(destination);
      return destination;
    }
    disconnect() {}
  }

  class VolumeContext {
    state = "running";
    currentTime = 0;
    sampleRate = 1;
    destination = new AudioNodeStub("destination");
    createGain() {
      const gain = Object.assign(new AudioNodeStub("gain"), { gain: audioParam() });
      gains.push(gain);
      return gain;
    }
    createConvolver() {
      return Object.assign(new AudioNodeStub("room"), { buffer: null, normalize: true });
    }
    createWaveShaper() {
      const node = waveShaper(new AudioNodeStub("clip"));
      clips.push(node);
      return node;
    }
    createOscillator() {
      return Object.assign(new AudioNodeStub("oscillator"), {
        frequency: audioParam(),
        detune: audioParam(),
        start() {},
        stop() {},
      });
    }
    createBuffer() {
      return { getChannelData: () => new Float32Array(1) };
    }
    createBufferSource() {
      return Object.assign(new AudioNodeStub("buffer-source"), {
        buffer: null,
        start() {},
        stop() {},
      });
    }
    createBiquadFilter() {
      return Object.assign(new AudioNodeStub("filter"), {
        frequency: audioParam(),
        Q: audioParam(),
      });
    }
  }

  setGlobal("setTimeout", () => 0);
  setGlobal("window", { AudioContext: VolumeContext });

  const { play, setVolume } = await import(`../dist/audio/engine.js?volume=${Date.now()}`);
  const { RECIPES } = await import("../dist/sounds/recipes.js");

  setVolume(2);
  play("tap", { volume: 0.5 });
  setVolume(0.5);
  play("tap", { volume: 0.5 });
  play("tap", { volume: 2 });
  play("tap", { volume: Number.NaN });
  setVolume(-1);
  setVolume(Number.NaN);
  setVolume(Number.POSITIVE_INFINITY);
  play("tap");

  const output = gains[0];
  const masters = gains.slice(1).filter((gain) => gain.connections.includes(output));

  assert.deepEqual(
    masters.map(({ gain }) => gain.value),
    [0.5, 0.25, 0.5, 0.5].map((volume) => RECIPES.tap.masterGain * volume),
  );
  assert.ok(output.gain.value > 1);
  const [subsonic] = output.connections;
  assert.equal(subsonic.name, "filter");
  assert.equal(subsonic.type, "highpass");
  assert.ok(subsonic.frequency.value >= 30 && subsonic.frequency.value <= 50);
  assert.equal(clips.length, 1);
  const [clip] = clips;
  assert.deepEqual(subsonic.connections, [clip]);
  assert.equal(clip.connections.length, 1);
  assert.equal(clip.connections[0].name, "destination");

  const { CLIP_KNEE } = await import("../dist/audio/output.js");
  assert.equal(clip.oversample, "none");
  const inputAt = (i) => (2 * i) / (clip.curve.length - 1) - 1;
  clip.curve.forEach((out, i) => {
    const input = inputAt(i);
    if (Math.abs(input) <= CLIP_KNEE) assert.ok(Math.abs(out - input) < 1e-6, `${input} passes untouched`);
    else assert.ok(Math.abs(out) < Math.abs(input) && Math.abs(out) >= CLIP_KNEE, `${input} is eased down`);
    if (i > 0) assert.ok(out >= clip.curve[i - 1], "the curve never folds back");
  });
  assert.ok(clip.curve.at(-1) < 1 && clip.curve[0] > -1);
});

test("every cue renders, deprecated names play, and every keystroke varies within bounds", async (context) => {
  context.after(restoreGlobals);
  let renders = 0;
  const filters = [];
  const delays = [];

  class AudioNodeStub {
    connect(destination) {
      return destination;
    }
    disconnect() {}
  }

  class WorkingContext {
    state = "running";
    currentTime = 0;
    sampleRate = 1;
    destination = new AudioNodeStub();
    createGain() {
      return Object.assign(new AudioNodeStub(), { gain: audioParam() });
    }
    createConvolver() {
      return Object.assign(new AudioNodeStub(), { buffer: null, normalize: true });
    }
    createWaveShaper() {
      return waveShaper(new AudioNodeStub());
    }
    createOscillator() {
      return Object.assign(new AudioNodeStub(), {
        frequency: audioParam(),
        detune: audioParam(),
        start() {},
        stop() {},
      });
    }
    createBuffer() {
      return { getChannelData: () => new Float32Array(1) };
    }
    createBufferSource() {
      return Object.assign(new AudioNodeStub(), { buffer: null, start() {}, stop() {} });
    }
    createBiquadFilter() {
      const filter = Object.assign(new AudioNodeStub(), { frequency: audioParam(), Q: audioParam() });
      filters.push(filter);
      return filter;
    }
    createDelay() {
      return Object.assign(new AudioNodeStub(), { delayTime: audioParam() });
    }
  }

  setGlobal("setTimeout", (callback, delay) => {
    renders++;
    delays.push(delay);
    return 0;
  });
  setGlobal("window", { AudioContext: WorkingContext });
  const { play, setTheme } = await import(`../dist/audio/engine.js?palette=${Date.now()}`);

  for (const cue of CANONICAL) play(cue);
  assert.equal(renders, CANONICAL.length);
  for (const cue of CANONICAL) {
    for (const emphasis of ["subtle", "normal", "strong", "loud"]) play(cue, { emphasis });
  }
  assert.equal(renders, CANONICAL.length * 5);
  // emphasis is heard as length too, so a strong cue rings longer than a subtle one
  const ring = (emphasis) => {
    play("success", { emphasis });
    return delays.at(-1);
  };
  assert.ok(ring("subtle") < ring("normal") && ring("normal") < ring("strong"));
  assert.equal(ring("loud"), ring("normal"));
  renders = 0;
  play("chime");
  play();
  assert.equal(renders, 2);

  // setTheme changes the material of future plays; unknown names change nothing
  const firstFilterOf = (cue) => {
    const before = filters.length;
    play(cue);
    return filters[before].frequency.value;
  };
  const { THEMES } = await import("../dist/sounds/themes.js");
  const near = (value, base, bound) => Math.abs(value / base - 1) <= bound + 1e-9;
  const mechTap = THEMES.mech.tap;
  const defaultTap = THEMES.default.tap;
  assert.ok(near(firstFilterOf("tap"), defaultTap.layers[0].filterFrequency, spread(defaultTap.layers[0], defaultTap.vary)));
  setTheme("mech");
  assert.ok(near(firstFilterOf("tap"), mechTap.layers[0].filterFrequency, spread(mechTap.layers[0], mechTap.vary)));
  setTheme("glass");
  setTheme(undefined);
  assert.ok(near(firstFilterOf("tap"), mechTap.layers[0].filterFrequency, spread(mechTap.layers[0], mechTap.vary)));
  const before = renders;
  for (const cue of CANONICAL) {
    for (const emphasis of ["subtle", "normal", "strong"]) play(cue, { emphasis });
  }
  assert.equal(renders - before, CANONICAL.length * 3);
  setTheme("default");
  assert.ok(near(firstFilterOf("tap"), defaultTap.layers[0].filterFrequency, spread(defaultTap.layers[0], defaultTap.vary)));

  // type's first layer is the switch click; its filter shows each stroke's pitch.
  const { RECIPES } = await import("../dist/sounds/recipes.js");
  const base = RECIPES.type.layers[0].filterFrequency;
  const bound = spread(RECIPES.type.layers[0], RECIPES.type.vary);
  const clicks = [];
  for (let i = 0; i < 200; i++) {
    const before = filters.length;
    play("type");
    clicks.push(filters[before].frequency.value / base - 1);
  }
  for (let i = 1; i < clicks.length; i++) assert.notEqual(clicks[i], clicks[i - 1]);
  assert.ok(clicks.every((offset) => Math.abs(offset) <= bound));
  assert.ok(Math.max(...clicks) > bound / 2 && Math.min(...clicks) < -bound / 2);

  // Variation is opt-in: a cue without it plays the recipe exactly.
  for (let i = 0; i < 3; i++) {
    const before = filters.length;
    play("select");
    assert.equal(filters[before].frequency.value, RECIPES.select.layers[0].filterFrequency);
  }

  // navigate's whoosh sweeps its noise filter; tap's filters stay put.
  const sweeps = (cue) => {
    const before = filters.length;
    play(cue);
    return filters.slice(before).filter((filter) => filter.frequency.ramps.length > 0).length;
  };
  assert.ok(sweeps("navigate") > 0);
  assert.equal(sweeps("tap"), 0);

  // play() takes the context bindings detect
  const { shapeFor } = await import("../dist/sounds/context.js");
  const SLOW = 10_000;
  const played = (cue, options) => {
    const before = filters.length;
    play(cue, options);
    return filters.slice(before);
  };
  const detent = RECIPES.select.layers[0].filterFrequency;
  const ratioOf = (options) => played("select", options)[0].frequency.value / detent;
  assert.ok(Math.abs(ratioOf({ direction: "forward" }) - 1.05) < 1e-9);
  assert.ok(Math.abs(ratioOf({ direction: "back" }) - 0.95) < 1e-9);
  // unknown values, and fields a cue doesn't listen to, leave it canonical
  for (const options of [{ direction: "up" }, { direction: 1 }, { direction: "BACK" }, { key: "enter" }, { input: "pen" }, null]) {
    assert.equal(ratioOf(options), 1, JSON.stringify(options));
  }
  const within = (cue, layer, context) => {
    const expected = shapeFor(cue, context, "normal", SLOW).pitch;
    const bound = spread(RECIPES[cue].layers[layer], RECIPES[cue].vary);
    for (let i = 0; i < 20; i++) {
      const ratio = played(cue, context)[0].frequency.value / RECIPES[cue].layers[layer].filterFrequency;
      assert.ok(Math.abs(ratio / expected - 1) <= bound + 1e-9, `${cue} ${JSON.stringify(context)}`);
    }
  };
  within("type", 0, { key: "enter" });
  within("tap", 0, { input: "keyboard" });

  // navigate: back plays the sweep falling, in both themes and at every emphasis
  const sweepOf = (options) => {
    const filter = played("navigate", options).find((f) => f.frequency.ramps.length > 0);
    return filter.frequency.ramps[0] - filter.frequency.value;
  };
  assert.ok(sweepOf() > 0 && sweepOf({ direction: "forward" }) > 0);
  for (const theme of ["default", "mech"]) {
    setTheme(theme);
    for (const emphasis of ["subtle", "normal", "strong"]) {
      assert.ok(sweepOf({ direction: "back", emphasis }) < 0, `${theme} ${emphasis}`);
    }
  }
  setTheme("default");
});

test("binding is delegated, dynamic, idempotent, and plays one cue per action", async (context) => {
  context.after(restoreGlobals);
  // the context each binding passes is read off exact pitches, so no per-play variation
  context.mock.method(Math, "random", () => 0.5);
  const { RECIPES } = await import("../dist/sounds/recipes.js");
  const gainOf = (cue) => RECIPES[cue].masterGain;
  // Cues are identified by master gain below, so the ones asserted on must differ.
  const identified = ["tap", "type", "select", "open", "success", "loading", "ready"];
  assert.equal(new Set(identified.map(gainOf)).size, identified.length);

  const masters = [];
  const filters = [];
  const oscillators = [];
  const delays = [];
  let renders = 0;

  class AudioNodeStub {
    connect(destination) {
      return destination;
    }
    disconnect() {}
  }

  class WorkingContext {
    state = "running";
    currentTime = 0;
    sampleRate = 1;
    destination = new AudioNodeStub();
    createGain() {
      const gain = Object.assign(new AudioNodeStub(), { gain: audioParam() });
      // The first gain of each render is its master.
      if (masters.length === renders) masters.push(gain);
      return gain;
    }
    createConvolver() {
      return Object.assign(new AudioNodeStub(), { buffer: null, normalize: true });
    }
    createWaveShaper() {
      masters.pop(); // the gain just created was the shared output bus, not a master
      return waveShaper(new AudioNodeStub());
    }
    createOscillator() {
      const frequency = audioParam();
      oscillators.push(frequency);
      return Object.assign(new AudioNodeStub(), {
        frequency,
        detune: audioParam(),
        start() {},
        stop() {},
      });
    }
    createBuffer() {
      return { getChannelData: () => new Float32Array(1) };
    }
    createBufferSource() {
      return Object.assign(new AudioNodeStub(), { buffer: null, start() {}, stop() {} });
    }
    createBiquadFilter() {
      const filter = Object.assign(new AudioNodeStub(), { frequency: audioParam(), Q: audioParam() });
      filters.push(filter);
      return filter;
    }
    createDelay() {
      return Object.assign(new AudioNodeStub(), { delayTime: audioParam() });
    }
  }

  class FakeElement {
    constructor(parent = null, tagName = "DIV", attributes = {}) {
      this.parent = parent;
      this.parentElement = parent;
      this.children = [];
      parent?.children.push(this);
      this.tagName = tagName;
      this.attributes = new Map(Object.entries(attributes));
      this.listeners = new Map();
    }
    addEventListener(type, listener, options) {
      if (options?.signal?.aborted) return; // as the DOM does
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
      options?.signal?.addEventListener("abort", () => listeners.splice(listeners.indexOf(listener), 1));
    }
    emit(type, target = this, options = {}) {
      const event = { target, relatedTarget: null, pointerType: "mouse", key: "a", ...options };
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
    setAttribute(name, value = "") {
      this.attributes.set(name, value);
    }
    removeAttribute(name) {
      this.attributes.delete(name);
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    hasAttribute(name) {
      return this.attributes.has(name);
    }
    closest(selector) {
      const names = selector.split(",").map((part) => part.slice(1, -1));
      for (let element = this; element; element = element.parent) {
        if (names.some((name) => element.hasAttribute(name))) return element;
      }
      return null;
    }
    contains(candidate) {
      for (let element = candidate; element; element = element.parent) {
        if (element === this) return true;
      }
      return false;
    }
    matches(selector) {
      return selector === ":disabled" && this.disabled === true;
    }
  }

  let now = 1_000;
  setGlobal("Element", FakeElement);
  setGlobal("Node", FakeElement);
  setGlobal("document", {});
  setGlobal("performance", { now: () => now });
  setGlobal("setTimeout", (callback, delay) => {
    renders++;
    delays.push(delay);
    return 0;
  });
  setGlobal("window", {
    AudioContext: WorkingContext,
    matchMedia: () => ({ matches: true }),
  });

  const root = new FakeElement();
  const { bind } = await import(`../dist/interactions/bind.js?binding=${Date.now()}`);
  const { setEnabled } = await import("../dist/audio/engine.js");
  bind(root);
  bind(root);
  for (const type of ["click", "change", "keydown", "pointerenter", "pointerdown", "pointerup"]) {
    assert.equal(root.listeners.get(type).length, 1, type);
  }

  // Asserts how many cues `action` played, and returns the last one's master gain.
  const played = (count, action) => {
    const before = renders;
    action();
    assert.equal(renders - before, count);
    return masters.at(-1).gain.value;
  };

  // tap: click, explicit values, deprecated values, invalid values, removal.
  const button = new FakeElement(root, "BUTTON", { "data-cuelume-tap": "" });
  assert.equal(played(1, () => root.emit("click", button)), gainOf("tap"));
  button.setAttribute("data-cuelume-tap", "open");
  assert.equal(played(1, () => root.emit("click", button)), gainOf("open"));
  button.setAttribute("data-cuelume-tap", "chime");
  assert.equal(played(1, () => root.emit("click", button)), gainOf("success"));
  // 0.2's loading and ready are cues again, not stand-ins
  button.setAttribute("data-cuelume-tap", "loading");
  assert.equal(played(1, () => root.emit("click", button)), gainOf("loading"));
  button.setAttribute("data-cuelume-tap", "ready");
  assert.equal(played(1, () => root.emit("click", button)), gainOf("ready"));
  button.setAttribute("data-cuelume-tap", "toString");
  assert.equal(played(1, () => root.emit("click", button)), gainOf("tap"));
  button.removeAttribute("data-cuelume-tap");
  played(0, () => root.emit("click", button));

  // Every click binding is live, and the innermost annotated element decides.
  for (const cue of ["toggle", "close", "navigate"]) {
    played(1, () => root.emit("click", new FakeElement(root, "BUTTON", { [`data-cuelume-${cue}`]: "" })));
  }
  const card = new FakeElement(root, "DIV", { "data-cuelume-tap": "" });
  const opener = new FakeElement(card, "BUTTON", { "data-cuelume-open": "" });
  assert.equal(played(1, () => root.emit("click", new FakeElement(opener, "SPAN"))), gainOf("open"));

  // select: a native control plays on change only; a custom option on click.
  const native = new FakeElement(root, "SELECT", { "data-cuelume-select": "" });
  played(0, () => root.emit("click", native));
  assert.equal(played(1, () => root.emit("change", native)), gainOf("select"));
  const option = new FakeElement(root, "LI", { "data-cuelume-select": "" });
  assert.equal(played(1, () => root.emit("click", option)), gainOf("select"));
  played(0, () => root.emit("change", new FakeElement(root, "SELECT")));

  // type: printable and editing keys only, rate limited.
  const input = new FakeElement(root, "INPUT", { "data-cuelume-type": "" });
  const key = (count, options, target = input) => {
    now += 100;
    played(count, () => root.emit("keydown", target, options));
  };
  assert.equal(played(1, () => root.emit("keydown", input)), gainOf("type"));
  now += 10;
  played(0, () => root.emit("keydown", input));
  for (const options of [
    { key: "Shift" },
    { key: "ArrowLeft" },
    { key: "Tab" },
    { key: "a", repeat: true },
    { key: "a", isComposing: true },
    { key: "Process", keyCode: 229 },
    { key: "c", metaKey: true },
    { key: "c", ctrlKey: true },
    { key: "Enter" },
  ]) {
    key(0, options);
  }
  for (const options of [{ key: " " }, { key: "Backspace" }, { key: "Delete" }, { key: "@", ctrlKey: true, altKey: true }]) {
    key(1, options);
  }
  key(1, { key: "Enter" }, new FakeElement(root, "TEXTAREA", { "data-cuelume-type": "" }));

  // Held Backspace or Delete keeps sounding while it deletes, and stops when nothing is left.
  const line = Object.assign(new FakeElement(root, "INPUT", { "data-cuelume-type": "" }), {
    value: "hello",
    selectionStart: 5,
    selectionEnd: 5,
  });
  key(1, { key: "Backspace" }, line);
  key(1, { key: "Backspace", repeat: true }, line);
  now += 30; // a fast key repeat is still held to the typing rate limit
  played(0, () => root.emit("keydown", line, { key: "Backspace", repeat: true }));
  key(1, { key: "Backspace", metaKey: true }, line); // delete to line start
  key(1, { key: "Backspace", altKey: true }, line); // delete word
  key(0, { key: "Delete", repeat: true }, line); // caret at the end: nothing ahead to delete
  line.selectionStart = line.selectionEnd = 0;
  key(0, { key: "Backspace", repeat: true }, line); // caret at the start: nothing behind
  key(1, { key: "Delete", repeat: true }, line);
  line.selectionEnd = 3;
  key(1, { key: "Backspace" }, line); // a selection always deletes
  line.value = "";
  line.selectionEnd = 0;
  key(0, { key: "Backspace" }, line);
  key(0, {}, Object.assign(new FakeElement(root, "INPUT", { "data-cuelume-type": "" }), { type: "password" }));
  key(0, {}, new FakeElement(root, "INPUT"));
  const form = new FakeElement(root, "FORM", { "data-cuelume-type": "" });
  key(0, { key: "Enter" }, new FakeElement(form, "BUTTON"));

  // Deprecated hover: fine mouse only, throttled, silent inside itself, defaults to select.
  const link = new FakeElement(root, "A", { "data-cuelume-hover": "" });
  now += 1_000;
  assert.equal(played(1, () => root.emit("pointerenter", link)), gainOf("select"));
  now += 100;
  played(0, () => root.emit("pointerenter", link));
  now += 51;
  played(1, () => root.emit("pointerenter", link));
  now += 151;
  played(0, () => root.emit("pointerenter", new FakeElement(link), { relatedTarget: link }));
  played(0, () => root.emit("pointerenter", link, { pointerType: "touch" }));

  // Deprecated press/release: a pair plays one tap, on press; release alone still plays.
  const pair = new FakeElement(root, "BUTTON", { "data-cuelume-press": "", "data-cuelume-release": "" });
  assert.equal(played(1, () => root.emit("pointerdown", pair, { pointerType: "touch" })), gainOf("tap"));
  played(0, () => root.emit("pointerup", pair, { pointerType: "touch" }));
  const releaseOnly = new FakeElement(root, "BUTTON", { "data-cuelume-release": "" });
  played(1, () => root.emit("pointerup", releaseOnly));

  // setEnabled(false) silences delegated playback too.
  setEnabled(false);
  played(0, () => root.emit("click", opener));
  setEnabled(true);
  played(1, () => root.emit("click", opener));

  // ---- context: each binding hands the engine what it knows about the interaction ----
  const firstFilter = (action) => {
    const before = filters.length;
    action();
    return filters[before].frequency.value;
  };

  // type: Enter in a textarea is a bigger, lower key than a letter
  const pad = new FakeElement(root, "TEXTAREA", { "data-cuelume-type": "" });
  const clickHz = RECIPES.type.layers[0].filterFrequency;
  now += 1_000;
  const letter = firstFilter(() => root.emit("keydown", pad, { key: "a" }));
  now += 1_000;
  const enter = firstFilter(() => root.emit("keydown", pad, { key: "Enter" }));
  assert.ok(letter > clickHz * 0.9 && enter < clickHz * 0.86);

  // select: the first pick in a group reads the previous choice from ARIA state
  const range = new FakeElement(root, "DIV");
  const [, week, month] = ["false", "true", "false"].map((checked) =>
    new FakeElement(range, "BUTTON", { "data-cuelume-select": "", "aria-checked": checked }));
  now += 1_000;
  assert.ok(firstFilter(() => root.emit("click", month)) > RECIPES.select.layers[0].filterFrequency);

  // select: among marked siblings a later pick rises and an earlier one falls; with no state, the first has no direction
  const days = new FakeElement(root, "DIV");
  const [mon, tue, wed] = [0, 1, 2].map(() => new FakeElement(days, "BUTTON", { "data-cuelume-select": "" }));
  const detentHz = RECIPES.select.layers[0].filterFrequency;
  now += 1_000;
  assert.equal(firstFilter(() => root.emit("click", mon)), detentHz);
  now += 1_000;
  assert.ok(firstFilter(() => root.emit("click", wed)) > detentHz);
  now += 1_000;
  assert.ok(firstFilter(() => root.emit("click", tue)) < detentHz);
  // a native select moves by selectedIndex
  const picker = Object.assign(new FakeElement(root, "SELECT", { "data-cuelume-select": "" }), { selectedIndex: 1 });
  now += 1_000;
  assert.equal(firstFilter(() => root.emit("change", picker)), detentHz);
  picker.selectedIndex = 3;
  now += 1_000;
  assert.ok(firstFilter(() => root.emit("change", picker)) > detentHz);

  // tap: touch and keyboard activation sound rounder and lower than a mouse click
  const glassHz = RECIPES.tap.layers[0].filterFrequency;
  const glass = new FakeElement(root, "BUTTON", { "data-cuelume-tap": "" });
  now += 1_000;
  const mouse = firstFilter(() => root.emit("click", glass));
  now += 1_000;
  const touch = firstFilter(() => root.emit("click", glass, { pointerType: "touch" }));
  now += 1_000;
  const keyboard = firstFilter(() => root.emit("click", glass, { pointerType: "", detail: 0 }));
  assert.ok(mouse > glassHz * 0.985 && touch < glassHz * 0.985 && keyboard < glassHz * 0.96);

  // data-cuelume-emphasis weights the cue, set on the element or any ancestor
  const ringOf = (action) => {
    action();
    return delays.at(-1);
  };
  now += 1_000;
  const plain = ringOf(() => root.emit("click", glass));
  const toolbar = new FakeElement(root, "DIV", { "data-cuelume-emphasis": "strong" });
  const publish = new FakeElement(toolbar, "BUTTON", { "data-cuelume-tap": "" });
  now += 1_000;
  assert.ok(ringOf(() => root.emit("click", publish)) > plain);
  glass.setAttribute("data-cuelume-emphasis", "subtle");
  now += 1_000;
  assert.ok(ringOf(() => root.emit("click", glass)) < plain);

  // data-cuelume-theme picks the material, on the element or any ancestor; the innermost wins
  const { THEMES } = await import("../dist/sounds/themes.js");
  assert.equal(new Set(["default", "mech", "bubble"].map((theme) => THEMES[theme].tap.masterGain)).size, 3);
  const modelMenu = new FakeElement(root, "DIV", { "data-cuelume-theme": "bubble" });
  const model = new FakeElement(modelMenu, "BUTTON", { "data-cuelume-tap": "" });
  now += 1_000;
  assert.equal(played(1, () => root.emit("click", model)), THEMES.bubble.tap.masterGain);
  model.setAttribute("data-cuelume-theme", "mech");
  now += 1_000;
  assert.equal(played(1, () => root.emit("click", model)), THEMES.mech.tap.masterGain);
  model.setAttribute("data-cuelume-theme", "glass"); // unknown: the active theme
  now += 1_000;
  assert.equal(played(1, () => root.emit("click", model)), gainOf("tap"));

  // toggle: switching off plays back, which sinks bubble's bloop
  const sinks = (element) => {
    const before = oscillators.length;
    now += 1_000;
    root.emit("click", element);
    const bloop = oscillators[before];
    return bloop.ramps[0] < bloop.value;
  };
  const bubbly = new FakeElement(root, "DIV", { "data-cuelume-theme": "bubble" });
  // a native checkbox has already changed when its click arrives
  const checkbox = Object.assign(new FakeElement(bubbly, "INPUT", { "data-cuelume-toggle": "" }), { type: "checkbox", checked: true });
  assert.equal(sinks(checkbox), false);
  checkbox.checked = false;
  assert.equal(sinks(checkbox), true);
  // ARIA state hasn't changed yet: "true" means this click switches it off
  const toggleSwitch = new FakeElement(bubbly, "BUTTON", { "data-cuelume-toggle": "", "aria-checked": "true" });
  assert.equal(sinks(toggleSwitch), true);
  toggleSwitch.setAttribute("aria-checked", "false");
  assert.equal(sinks(toggleSwitch), false);
  assert.equal(sinks(new FakeElement(bubbly, "BUTTON", { "data-cuelume-toggle": "", "aria-pressed": "true" })), true);
  // no state, a mixed state, or an input that isn't a checkbox: no direction
  for (const element of [
    new FakeElement(bubbly, "BUTTON", { "data-cuelume-toggle": "" }),
    new FakeElement(bubbly, "BUTTON", { "data-cuelume-toggle": "", "aria-checked": "mixed" }),
    Object.assign(new FakeElement(bubbly, "INPUT", { "data-cuelume-toggle": "" }), { type: "button", checked: false }),
  ]) {
    assert.equal(sinks(element), false);
  }

  // a marked label around its control plays once: the browser forwards the label's click to the
  // control, and that second click carries the control's new state
  const wifi = new FakeElement(bubbly, "LABEL", { "data-cuelume-toggle": "" });
  const box = Object.assign(new FakeElement(wifi, "INPUT"), { type: "checkbox", checked: true });
  wifi.control = box;
  now += 1_000;
  played(0, () => root.emit("click", wifi));
  now += 1_000;
  played(1, () => root.emit("click", box));
  assert.equal(sinks(box), false);
  box.checked = false;
  assert.equal(sinks(box), true);
  // a label whose control sits elsewhere is the only click that finds the mark, so it still plays
  const detached = new FakeElement(bubbly, "LABEL", { "data-cuelume-toggle": "" });
  detached.control = Object.assign(new FakeElement(root, "INPUT"), { type: "checkbox", checked: false });
  now += 1_000;
  played(1, () => root.emit("click", detached));

  // ---- a gesture sounds as it goes down and lets go as it lifts ----
  const tones = (action) => {
    const before = oscillators.length;
    action();
    return oscillators.length - before;
  };
  // press's tap: the press carries the note, the release only clicks
  const trackpad = new FakeElement(root, "BUTTON", { "data-cuelume-tap": "", "data-cuelume-theme": "press" });
  now += 1_000;
  assert.ok(tones(() => played(1, () => root.emit("pointerdown", trackpad))) > 0);
  assert.equal(tones(() => played(1, () => root.emit("click", trackpad))), 0);
  // touch plays it whole on lift, so a scroll that starts on the button is silent
  now += 1_000;
  played(0, () => root.emit("pointerdown", trackpad, { pointerType: "touch" }));
  assert.ok(tones(() => played(1, () => root.emit("click", trackpad, { pointerType: "touch" }))) > 0);
  // keyboard activation has no press first, so it plays whole
  now += 1_000;
  assert.ok(tones(() => played(1, () => root.emit("click", trackpad, { pointerType: "", detail: 0 }))) > 0);
  // a cancelled press never lets go, so the next click plays whole; a right button presses nothing
  now += 1_000;
  played(1, () => root.emit("pointerdown", trackpad));
  root.emit("pointercancel", trackpad);
  now += 1_000;
  assert.ok(tones(() => played(1, () => root.emit("click", trackpad))) > 0);
  played(0, () => root.emit("pointerdown", trackpad, { button: 2 }));
  // a theme with nothing to let go plays the press and stays silent on the click
  const plainTap = new FakeElement(root, "BUTTON", { "data-cuelume-tap": "" });
  now += 1_000;
  played(1, () => root.emit("pointerdown", plainTap));
  played(0, () => root.emit("click", plainTap));

  // a toggle pressed reads its state before the click changes it: an unchecked box is switching on
  const pressSinks = (element) => {
    const before = oscillators.length;
    now += 1_000;
    root.emit("pointerdown", element);
    root.emit("pointercancel", element);
    const bloop = oscillators[before];
    return bloop.ramps[0] < bloop.value;
  };
  const optIn = Object.assign(new FakeElement(bubbly, "INPUT", { "data-cuelume-toggle": "" }), { type: "checkbox", checked: false });
  assert.equal(pressSinks(optIn), false);
  optIn.checked = true;
  assert.equal(pressSinks(optIn), true);
  const plan = Object.assign(new FakeElement(bubbly, "INPUT", { "data-cuelume-toggle": "" }), { type: "radio", checked: false });
  assert.equal(pressSinks(plan), false);

  // a pen presses nothing either: it scrolls like a finger, and its pointerdown does not unlock audio
  now += 1_000;
  played(0, () => root.emit("pointerdown", trackpad, { pointerType: "pen" }));
  assert.ok(tones(() => played(1, () => root.emit("click", trackpad, { pointerType: "pen" }))) > 0);
  // a disabled control never clicks, so it presses nothing
  const locked = Object.assign(new FakeElement(root, "BUTTON", { "data-cuelume-tap": "" }), { disabled: true });
  played(0, () => root.emit("pointerdown", locked));
  // a press that slid off, with no click and no cancel, is over once a key or another pointer goes down:
  // the next activation plays whole
  const slid = new FakeElement(root, "BUTTON", { "data-cuelume-tap": "" });
  now += 1_000;
  played(1, () => root.emit("pointerdown", slid));
  root.emit("keydown", slid, { key: "Enter", code: "Enter" });
  now += 1_000;
  played(1, () => root.emit("click", slid, { pointerType: "", detail: 0 }));
  now += 1_000;
  played(1, () => root.emit("pointerdown", slid));
  played(0, () => root.emit("pointerdown", slid, { pointerType: "touch" }));
  now += 1_000;
  played(1, () => root.emit("click", slid, { pointerType: "touch" }));

  // a pick is made on the click: one pressed and abandoned moves nothing, so the next is measured from the last made
  const tabs = new FakeElement(root, "DIV");
  const [first, second, third] = [0, 1, 2].map(() => new FakeElement(tabs, "BUTTON", { "data-cuelume-select": "" }));
  now += 1_000;
  root.emit("pointerdown", first);
  root.emit("click", first);
  now += 1_000;
  root.emit("pointerdown", third);
  root.emit("pointercancel", third);
  now += 1_000;
  assert.ok(firstFilter(() => root.emit("pointerdown", second)) > detentHz);
  root.emit("click", second);
  now += 1_000;
  assert.ok(firstFilter(() => root.emit("pointerdown", first)) < detentHz);
  root.emit("pointercancel", first);

  // a typed key lets go on keyup, once, and only if its keydown played
  const keys = new FakeElement(root, "TEXTAREA", { "data-cuelume-type": "", "data-cuelume-theme": "press" });
  now += 1_000;
  played(1, () => root.emit("keydown", keys, { key: "a", code: "KeyA" }));
  played(1, () => root.emit("keyup", keys, { key: "a", code: "KeyA" }));
  played(0, () => root.emit("keyup", keys, { key: "a", code: "KeyA" }));
  played(0, () => root.emit("keyup", keys, { key: "b", code: "KeyB" }));
  now += 1_000;
  played(0, () => root.emit("keydown", keys, { key: "Shift", code: "ShiftLeft" }));
  played(0, () => root.emit("keyup", keys, { key: "Shift", code: "ShiftLeft" }));
  // Shift lifting first renames the key, "A" to "a": it is the same key letting go
  now += 1_000;
  played(1, () => root.emit("keydown", keys, { key: "A", code: "KeyA" }));
  played(1, () => root.emit("keyup", keys, { key: "a", code: "KeyA" }));
  // keys that overlap, as fast typing does, each let go
  now += 1_000;
  played(1, () => root.emit("keydown", keys, { key: "a", code: "KeyA" }));
  now += 100;
  played(1, () => root.emit("keydown", keys, { key: "s", code: "KeyS" }));
  played(1, () => root.emit("keyup", keys, { key: "a", code: "KeyA" }));
  played(1, () => root.emit("keyup", keys, { key: "s", code: "KeyS" }));
  // a key lifted after focus left the field is done: it lets go of nothing later
  now += 1_000;
  played(1, () => root.emit("keydown", keys, { key: "d", code: "KeyD" }));
  played(0, () => root.emit("keyup", root, { key: "d", code: "KeyD" }));
  played(0, () => root.emit("keyup", keys, { key: "d", code: "KeyD" }));

  // bind() hands back its undo. A root stays bound until every caller has let go, an undo counts once,
  // and the root can be bound again afterwards.
  const panel = new FakeElement();
  const save = new FakeElement(panel, "BUTTON", { "data-cuelume-tap": "" });
  const [first_, second_] = [bind(panel), bind(panel)];
  now += 1_000;
  played(1, () => panel.emit("click", save));
  first_();
  first_();
  now += 1_000;
  played(1, () => panel.emit("click", save));
  second_();
  for (const listeners of panel.listeners.values()) assert.equal(listeners.length, 0);
  now += 1_000;
  played(0, () => panel.emit("click", save));
  const again = bind(panel);
  now += 1_000;
  played(1, () => panel.emit("click", save));
  again();
});

test("muting is immediate: what is ringing fades at once, and a press from before it is forgotten", async (context) => {
  context.after(restoreGlobals);
  const { Context, log } = recordingContext();
  const gains = [];
  class Recording extends Context {
    createGain() {
      const gain = super.createGain();
      gains.push(gain);
      return gain;
    }
  }
  setGlobal("performance", { now: () => 0 });
  setGlobal("setTimeout", () => 0);
  setGlobal("window", { AudioContext: Recording });
  const { play, press, release, setEnabled } = await import(`../dist/audio/engine.js?mute=${Date.now()}`);
  const { THEMES } = await import("../dist/sounds/themes.js");
  const masterOf = (recipe) => gains.findLast((gain) => gain.gain.value === recipe.masterGain);

  play("attention");
  press("tap", { theme: "press" });
  const ringing = [masterOf(THEMES.default.attention), masterOf(THEMES.press.tap)];
  assert.ok(ringing.every((master) => master.gain.swell === undefined));
  setEnabled(false);
  for (const master of ringing) {
    assert.equal(master.gain.swell, 0);
    assert.ok(master.gain.swellAt > 0 && master.gain.swellAt < 0.05, "at once, without a click");
  }
  // the press from before the mute never lets go into the sound that came back
  setEnabled(true);
  const before = log.sources.length;
  release("tap");
  assert.equal(log.sources.length, before);
  // and a cue played afterwards rings as usual
  play("attention");
  assert.equal(masterOf(THEMES.default.attention).gain.swell, undefined);
  assert.ok(log.sources.length > before);
});

test("unlock starts audio from a gesture and says whether cues can sound", async (context) => {
  context.after(restoreGlobals);
  const userActivation = { hasBeenActive: false };
  setGlobal("navigator", { userActivation });

  // no Web Audio at all: the server, an old browser
  const bare = await import(`../dist/audio/engine.js?bare=${Date.now()}`);
  assert.equal(await bare.unlock(), false);

  let constructions = 0;
  class Suspended {
    state = "suspended";
    constructor() {
      constructions++;
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
  }
  setGlobal("window", { AudioContext: Suspended });
  const { unlock } = await import(`../dist/audio/engine.js?unlock=${Date.now()}`);
  // before any interaction the browser would refuse, so nothing is even built
  assert.equal(await unlock(), false);
  assert.equal(constructions, 0);
  userActivation.hasBeenActive = true;
  assert.equal(await unlock(), true);
  assert.equal(await unlock(), true, "already running");
  assert.equal(constructions, 1);

  // a browser that refuses, by rejecting or by staying suspended
  for (const resume of [() => Promise.reject(new Error("blocked")), () => Promise.resolve(), () => { throw new Error("blocked"); }]) {
    setGlobal("window", { AudioContext: class { state = "suspended"; resume = resume; } });
    const refused = await import(`../dist/audio/engine.js?refused=${Math.random()}`);
    assert.equal(await refused.unlock(), false);
  }
});

test("every play rings into one shared room, and a finished play lets go of it", async (context) => {
  context.after(restoreGlobals);
  const timers = [];
  const disconnected = [];
  const made = [];

  class AudioNodeStub {
    constructor(name) {
      this.name = name;
      this.connections = [];
      made.push(this);
    }
    connect(destination) {
      this.connections.push(destination);
      return destination;
    }
    disconnect() {
      disconnected.push(this.name);
    }
  }

  let gainCount = 0;
  class RoomContext {
    state = "running";
    currentTime = 0;
    sampleRate = 48000;
    destination = new AudioNodeStub("destination");
    createGain() {
      const names = ["output", "master", "send"];
      return Object.assign(new AudioNodeStub(names[gainCount++] ?? "layer-gain"), { gain: audioParam() });
    }
    createWaveShaper() {
      return waveShaper(new AudioNodeStub("clip"));
    }
    createConvolver() {
      return Object.assign(new AudioNodeStub("room"), { buffer: null, normalize: true });
    }
    createBuffer(channels, length) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, getChannelData: (channel) => data[channel] };
    }
    createBufferSource() {
      return Object.assign(new AudioNodeStub("noise"), { buffer: null, start() {}, stop() {} });
    }
    createBiquadFilter() {
      return Object.assign(new AudioNodeStub("filter"), { frequency: audioParam(), Q: audioParam() });
    }
    createOscillator() {
      return Object.assign(new AudioNodeStub("oscillator"), { frequency: audioParam(), detune: audioParam(), start() {}, stop() {} });
    }
  }

  setGlobal("setTimeout", (callback, delay) => {
    timers.push({ callback, delay });
    return 0;
  });
  setGlobal("window", { AudioContext: RoomContext });

  const { play } = await import(`../dist/audio/engine.js?room=${Date.now()}`);
  const { RECIPES } = await import("../dist/sounds/recipes.js");
  const { LANDED } = await import("../dist/sounds/layers.js");
  play("success");

  const node = (name) => made.find((n) => n.name === name);
  const [output, master, send, room] = ["output", "master", "send", "room"].map(node);
  // dry to the output, and a faint send through the walls into the room, which returns to the output
  assert.ok(master.connections.includes(output) && master.connections.includes(send));
  const walls = send.connections[0];
  assert.deepEqual(walls.connections, [room]);
  assert.deepEqual(room.connections, [output]);
  assert.deepEqual(output.connections[0].connections, [node("clip")]);
  // success lands, so it rings into the room more than a tap does
  assert.equal(RECIPES.success.room, LANDED);
  assert.ok(send.gain.value > 0.05 * LANDED && send.gain.value < 0.1 * LANDED);
  // the room is stereo, silent before its first reflection, then dies away, each channel at unit energy
  assert.equal(room.normalize, false);
  const impulse = [0, 1].map((channel) => room.buffer.getChannelData(channel));
  for (const data of impulse) {
    assert.equal(data[0], 0);
    const energy = data.reduce((sum, x) => sum + x * x, 0);
    assert.ok(Math.abs(energy - 1) < 1e-4);
    const quarter = data.length / 4;
    const early = data.slice(0, quarter).reduce((sum, x) => sum + x * x, 0);
    const late = data.slice(-quarter).reduce((sum, x) => sum + x * x, 0);
    assert.ok(early > 100 * late);
  }
  assert.notDeepEqual(impulse[0], impulse[1]);

  // one cleanup, when the last layer has finished; the room itself stays up for the next play
  assert.equal(timers.length, 1);
  const longest = Math.max(...RECIPES.success.layers.filter((l) => l.from !== "strong").map((l) => l.attack + l.decay));
  assert.equal(Math.round(timers[0].delay), Math.round((longest + 0.1) * 1000));
  timers[0].callback();
  assert.deepEqual(disconnected, ["master", "send"]);

  // the room and the noise are built once, not per play
  const rooms = made.filter((n) => n.name === "room").length;
  play("tap");
  play("type");
  assert.equal(made.filter((n) => n.name === "room").length, rooms);

  const reloaded = await import(`../dist/audio/engine.js?reloaded=${Date.now()}`);
  reloaded.play("success");
  const [firstRoom, secondRoom] = made.filter((n) => n.name === "room");
  for (const channel of [0, 1]) assert.deepEqual(secondRoom.buffer.getChannelData(channel), firstRoom.buffer.getChannelData(channel));
  const noises = made.filter((n) => n.name === "noise").map((n) => n.buffer);
  assert.notEqual(noises.at(-1), noises[0]);
  assert.deepEqual(noises.at(-1).getChannelData(0), noises[0].getChannelData(0));
});

test("the room is the same room at every sample rate", async () => {
  const { fillRoom, ROOM_SEEDS, ROOM_SECONDS } = await import("../dist/audio/output.js");
  const returnAt = (rate, hertz) => {
    const impulse = new Float32Array(Math.floor(ROOM_SECONDS * rate));
    fillRoom(impulse, rate, ROOM_SEEDS[0]);
    let real = 0, imaginary = 0;
    impulse.forEach((x, i) => {
      real += x * Math.cos((2 * Math.PI * hertz * i) / rate);
      imaginary += x * Math.sin((2 * Math.PI * hertz * i) / rate);
    });
    return 10 * Math.log10(real * real + imaginary * imaginary);
  };
  for (const hertz of [196, 392, 523.25, 783.99, 880, 1318.51]) {
    for (const rate of [44100, 96000]) {
      const off = returnAt(rate, hertz) - returnAt(48000, hertz);
      assert.ok(Math.abs(off) < 0.25, `${hertz} Hz returns ${off.toFixed(2)} dB off at ${rate} Hz`);
    }
  }
});
