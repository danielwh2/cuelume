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
  linearRampToValueAtTime(value) {
    this.swell = value;
  },
});

function compressor(node) {
  return Object.assign(node, {
    threshold: audioParam(),
    knee: audioParam(),
    ratio: audioParam(),
    attack: audioParam(),
    release: audioParam(),
  });
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
    createDynamicsCompressor() {
      return compressor(new Node());
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
// Every play starts this far ahead of the context's clock.
const PLAYBACK_LEAD = 0.01;
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
      for (const layer of recipe.layers) {
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
  const { struck, BAR, MALLET } = await import("../dist/sounds/recipes.js");
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

test("every cue is one sound: all its layers strike together, in every theme", async () => {
  const { THEMES } = await import("../dist/sounds/themes.js");
  for (const [theme, cues] of Object.entries(THEMES)) {
    for (const [cue, recipe] of Object.entries(cues)) {
      for (const layer of recipe.layers) assert.equal(layer.offset ?? 0, 0, `${theme} ${cue} strikes twice`);
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
      assert.ok(near(s.at - PLAYBACK_LEAD, (offset * 300) / 800) && near(l.at - PLAYBACK_LEAD, (offset * 2000) / 800), `${theme} layer ${i} starts in step`);
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

test("every layer starts a little ahead, and a play whose sources never end is still let go", async (context) => {
  context.after(restoreGlobals);
  const { Context, log } = recordingContext();
  const timers = [];
  const masters = [];
  class Recording extends Context {
    currentTime = 5;
    createGain() {
      const gain = Object.assign(super.createGain(), {
        disconnect() {
          gain.disconnects = (gain.disconnects ?? 0) + 1;
        },
      });
      masters.push(gain);
      return gain;
    }
  }
  setGlobal("setTimeout", (callback, delay) => {
    timers.push({ callback, delay });
    return 0;
  });
  setGlobal("window", { AudioContext: Recording });
  const { play } = await import(`../dist/audio/engine.js?lead=${Date.now()}`);
  const { THEMES } = await import("../dist/sounds/themes.js");

  play("tap");
  // a cold renderer can drop a source scheduled for "now", so nothing is
  assert.ok(log.sources.length > 0 && log.sources.every((source) => source.at === 5 + PLAYBACK_LEAD));
  const master = masters.find((gain) => gain.gain.value === THEMES.default.tap.masterGain);

  // a suspended context never ends its sources: the timer lets the play go once, and a late end changes nothing
  assert.equal(timers.length, 1);
  timers[0].callback();
  assert.equal(master.disconnects, 1);
  for (const source of log.sources) source.onended();
  timers[0].callback();
  assert.equal(master.disconnects, 1);
  // it is no longer tap's voice, so the next tap has nothing to release
  play("tap");
  assert.equal(master.gain.ramps.length, 0);
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
      ring: (layerGains[i].gain.rampTimes[0] - PLAYBACK_LEAD - layer.attack) / layer.decay,
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

  setGlobal("setTimeout", () => 0); // the idle timer a resumed, silent context starts
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
  const compressors = [];

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
    createDynamicsCompressor() {
      const node = compressor(new AudioNodeStub("compressor"));
      compressors.push(node);
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
  assert.equal(compressors.length, 1);
  assert.deepEqual(output.connections, [compressors[0]]);
  assert.equal(compressors[0].connections.length, 1);
  assert.equal(compressors[0].connections[0].name, "destination");
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
    createDynamicsCompressor() {
      return compressor(new AudioNodeStub());
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
    createDynamicsCompressor() {
      masters.pop(); // the gain just created was the shared output bus, not a master
      return compressor(new AudioNodeStub());
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
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
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
  for (const type of ["click", "change", "keydown", "pointerenter", "pointerdown", "pointerup", "pointermove", "scroll"]) {
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
  // The typing above disarmed it before the mouse had been seen, so the first move only
  // says where the mouse is; the next re-arms.
  const link = new FakeElement(root, "A", { "data-cuelume-hover": "" });
  const move = (clientX, clientY) => root.emit("pointermove", root, { clientX, clientY });
  now += 1_000;
  move(50, 50);
  played(0, () => root.emit("pointerenter", link));
  move(60, 50);
  assert.equal(played(1, () => root.emit("pointerenter", link)), gainOf("select"));
  now += 100;
  played(0, () => root.emit("pointerenter", link));
  now += 51;
  played(1, () => root.emit("pointerenter", link));
  now += 151;
  played(0, () => root.emit("pointerenter", new FakeElement(link), { relatedTarget: link }));
  played(0, () => root.emit("pointerenter", link, { pointerType: "touch" }));

  // A mouse press disarms hover: the pointerenter a browser re-dispatches when an SPA
  // navigation swaps the DOM under the still cursor stays quiet, however long that takes.
  now += 1_000;
  played(0, () => root.emit("pointerdown", link, { clientX: 10, clientY: 10 }));
  now += 10_000;
  played(0, () => root.emit("pointerenter", link));
  // hand jitter within 4px stays quiet; real movement re-arms at once, and the
  // suppressed enters didn't take the throttle's slot
  move(12, 11);
  played(0, () => root.emit("pointerenter", link));
  move(30, 30);
  played(1, () => root.emit("pointerenter", link));
  // a scroll disarms at the last mouse position
  root.emit("scroll");
  now += 1_000;
  played(0, () => root.emit("pointerenter", link));
  move(31, 31);
  played(0, () => root.emit("pointerenter", link));
  move(60, 60);
  played(1, () => root.emit("pointerenter", link));
  // so does a key: Enter on a link navigates under a still mouse too
  now += 1_000;
  played(0, () => root.emit("keydown", new FakeElement(root, "A"), { key: "Enter" }));
  played(0, () => root.emit("pointerenter", link));
  move(90, 90);
  played(1, () => root.emit("pointerenter", link));
  // a touch press leaves the mouse-only hover armed
  now += 1_000;
  played(0, () => root.emit("pointerdown", link, { pointerType: "touch", clientX: 0, clientY: 0 }));
  played(1, () => root.emit("pointerenter", link));

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
    sampleRate = 8000;
    destination = new AudioNodeStub("destination");
    createGain() {
      const names = ["output", "master", "send"];
      return Object.assign(new AudioNodeStub(names[gainCount++] ?? "layer-gain"), { gain: audioParam() });
    }
    createDynamicsCompressor() {
      return compressor(new AudioNodeStub("limiter"));
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
  const { RECIPES, LANDED } = await import("../dist/sounds/recipes.js");
  play("success");

  const node = (name) => made.find((n) => n.name === name);
  const [output, master, send, room] = ["output", "master", "send", "room"].map(node);
  // dry to the output, and a faint send through the walls into the room, which returns to the output
  assert.ok(master.connections.includes(output) && master.connections.includes(send));
  const walls = send.connections[0];
  assert.deepEqual(walls.connections, [room]);
  assert.deepEqual(room.connections, [output]);
  assert.deepEqual(output.connections, [node("limiter")]);
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

  // one cleanup, when the last of its sources has ended; the room itself stays up for the next play
  assert.equal(timers.length, 1);
  const sources = made.filter((n) => n.name === "oscillator" || n.name === "noise");
  for (const source of sources.slice(1)) source.onended();
  assert.deepEqual(disconnected, []);
  sources[0].onended();
  assert.deepEqual(disconnected, ["master", "send"]);
  // the timer kept for a context that never ends its sources finds nothing left to do
  const longest = Math.max(...RECIPES.success.layers.filter((l) => l.from !== "strong").map((l) => l.attack + l.decay));
  assert.equal(Math.round(timers[0].delay), Math.round((PLAYBACK_LEAD + longest + 0.05 + 1) * 1000));
  timers[0].callback();
  assert.deepEqual(disconnected, ["master", "send"]);

  // the room and the noise are built once, not per play
  const rooms = made.filter((n) => n.name === "room").length;
  play("tap");
  play("type");
  assert.equal(made.filter((n) => n.name === "room").length, rooms);
});

// Stands in for setTimeout and clearTimeout; `tick(ms)` runs whatever falls due.
function manualTimers() {
  let now = 0;
  let id = 0;
  const due = new Map();
  setGlobal("setTimeout", (callback, delay = 0) => {
    due.set(++id, { callback, at: now + delay });
    return id;
  });
  setGlobal("clearTimeout", (timer) => due.delete(timer));
  return {
    due,
    tick(ms) {
      now += ms;
      for (const [timer, { callback, at }] of [...due].sort((a, b) => a[1].at - b[1].at)) {
        if (at <= now && due.delete(timer)) callback();
      }
    },
  };
}

// A recording context that suspends and resumes when the test settles it, as a browser does a moment later.
function suspendableContext() {
  const { Context, log } = recordingContext();
  const made = [];
  class Suspendable extends Context {
    calls = [];
    pending = [];
    constructor() {
      super();
      made.push(this);
    }
    suspend() {
      this.calls.push("suspend");
      return this.later("suspended");
    }
    resume() {
      this.calls.push("resume");
      return this.later("running");
    }
    later(state) {
      return new Promise((resolve) => this.pending.push(() => {
        this.state = state;
        resolve();
      }));
    }
    settle() {
      for (const done of this.pending.splice(0)) done();
    }
  }
  return { Suspendable, log, made };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("the context suspends a second after the last play ends, and the next play resumes it", async (context) => {
  context.after(restoreGlobals);
  const { Suspendable, log, made } = suspendableContext();
  const timers = manualTimers();
  setGlobal("window", { AudioContext: Suspendable });
  const { play } = await import(`../dist/audio/engine.js?idle=${Date.now()}`);
  const end = (from) => {
    for (const source of log.sources.slice(from)) source.onended();
  };

  play("tap");
  const ctx = made[0];
  end(0);
  timers.tick(999);
  assert.deepEqual(ctx.calls, []);
  timers.tick(1);
  assert.deepEqual(ctx.calls, ["suspend"]);
  ctx.settle();
  await flush();
  assert.equal(ctx.state, "suspended");

  // the next play resumes the same context, then renders
  const before = log.sources.length;
  play("tap");
  assert.equal(log.sources.length, before);
  ctx.settle();
  await flush();
  assert.deepEqual(ctx.calls, ["suspend", "resume"]);
  assert.ok(log.sources.length > before);
  assert.equal(made.length, 1);

  // a play before the timer fires cancels it, and overlapping plays suspend only once the last has ended
  end(before);
  timers.tick(500);
  const success = log.sources.length;
  play("success");
  const tap = log.sources.length;
  play("tap");
  end(tap);
  timers.tick(500);
  assert.equal(ctx.calls.length, 2);
  for (const source of log.sources.slice(success, tap)) source.onended();
  timers.tick(999);
  assert.equal(ctx.calls.length, 2);
  timers.tick(1);
  assert.deepEqual(ctx.calls, ["suspend", "resume", "suspend"]);
});

test("a play while a suspend is in flight resumes first, and setEnabled(false) lets go at once", async (context) => {
  context.after(restoreGlobals);
  const { Suspendable, log, made } = suspendableContext();
  const timers = manualTimers();
  setGlobal("window", { AudioContext: Suspendable });
  const { play, setEnabled } = await import(`../dist/audio/engine.js?suspending=${Date.now()}`);

  play("tap");
  const ctx = made[0];
  for (const source of log.sources) source.onended();
  timers.tick(1000);
  assert.deepEqual(ctx.calls, ["suspend"]);
  // still "running", but about to stop: rendering now would play into a suspended context
  assert.equal(ctx.state, "running");
  const before = log.sources.length;
  play("tap");
  assert.equal(log.sources.length, before);
  assert.deepEqual(ctx.calls, ["suspend", "resume"]);
  ctx.settle();
  await flush();
  assert.equal(ctx.state, "running");
  assert.ok(log.sources.length > before);

  // switched off while a play still sounds: it suspends once that play has ended
  setEnabled(false);
  assert.equal(ctx.calls.length, 2);
  for (const source of log.sources) source.onended();
  timers.tick(1000);
  assert.deepEqual(ctx.calls, ["suspend", "resume", "suspend"]);
  ctx.settle();
  await flush();

  // switched off with nothing sounding: it suspends right away
  setEnabled(true);
  play("tap");
  ctx.settle();
  await flush();
  for (const source of log.sources) source.onended();
  assert.equal(ctx.calls.length, 4);
  setEnabled(false);
  assert.deepEqual(ctx.calls, ["suspend", "resume", "suspend", "resume", "suspend"]);
  setEnabled(true);
});

test("a refused or missing suspend and a refused resume stay silent", async (context) => {
  context.after(restoreGlobals);
  const { Context, log } = recordingContext();
  const timers = manualTimers();
  const calls = [];
  class Refusing extends Context {
    suspend() {
      calls.push("suspend");
      return Promise.reject(new Error("no"));
    }
    resume() {
      calls.push("resume");
      return Promise.reject(new Error("no"));
    }
  }
  setGlobal("window", { AudioContext: Refusing });
  const refusing = await import(`../dist/audio/engine.js?refused=${Date.now()}`);
  refusing.play("tap");
  for (const source of log.sources) source.onended();
  timers.tick(1000);
  await flush();
  // the refusal leaves it running, and nothing in flight, so the next play renders straight away
  const before = log.sources.length;
  refusing.play("tap");
  assert.ok(log.sources.length > before);
  assert.deepEqual(calls, ["suspend"]);

  class Throwing extends Context {
    state = "suspended";
    suspend() {
      throw new Error("no");
    }
    resume() {
      throw new Error("no");
    }
  }
  setGlobal("window", { AudioContext: Throwing });
  const throwing = await import(`../dist/audio/engine.js?throwing=${Date.now()}`);
  assert.doesNotThrow(() => throwing.play("tap"));

  // an older context without suspend() simply stays running
  setGlobal("window", { AudioContext: Context });
  const old = await import(`../dist/audio/engine.js?nosuspend=${Date.now()}`);
  old.play("tap");
  for (const source of log.sources) source.onended();
  assert.doesNotThrow(() => timers.tick(1000));
  assert.doesNotThrow(() => old.setEnabled(false));
});

// A window that keeps its listeners, so a test can fire a gesture at them.
function listeningWindow(AudioContext) {
  const listeners = [];
  return {
    ...(AudioContext ? { AudioContext } : {}),
    listeners,
    addEventListener(type, listener, options) {
      listeners.push({ type, listener, options });
    },
    removeEventListener(type, listener, capture) {
      const at = listeners.findIndex((entry) => entry.type === type && entry.listener === listener && capture === true);
      if (at >= 0) listeners.splice(at, 1);
    },
    emit(type) {
      for (const { listener } of listeners.filter((entry) => entry.type === type)) listener({ type });
    },
  };
}

const GESTURES = ["click", "keydown", "mousedown", "touchend"];
const listening = (win) => win.listeners.map((entry) => entry.type).sort();

test("a play blocked before activation starts audio on the first tap that counts", async (context) => {
  context.after(restoreGlobals);
  const { Suspendable, log, made } = suspendableContext();
  class Blocked extends Suspendable {
    state = "suspended";
  }
  const timers = manualTimers();
  const userActivation = { hasBeenActive: false };
  const win = listeningWindow(Blocked);
  setGlobal("navigator", { userActivation });
  setGlobal("window", win);
  const { play, setEnabled } = await import(`../dist/audio/engine.js?gesture=${Date.now()}`);

  // a swipe's cue: no context yet, and one passive capture listener per gesture
  play("navigate");
  play("navigate");
  assert.equal(made.length, 0);
  assert.deepEqual(listening(win), GESTURES);
  assert.ok(win.listeners.every(({ options }) => options.capture === true && options.passive === true));

  // the swipe's own touchend grants nothing on iOS: keep waiting
  win.emit("touchend");
  assert.equal(made.length, 0);

  // switched off, a tap starts nothing
  userActivation.hasBeenActive = true;
  setEnabled(false);
  win.emit("click");
  assert.equal(made.length, 0);
  setEnabled(true);

  // a tap anywhere does, even one with no cue of its own; the blocked cue stays dropped
  win.emit("touchend");
  const ctx = made[0];
  assert.deepEqual(ctx.calls, ["resume"]);
  ctx.settle();
  await flush();
  assert.equal(ctx.state, "running");
  assert.deepEqual(win.listeners, []);
  assert.equal(log.sources.length, 0);
  // started without a cue, it still lets go of the device
  timers.tick(1000);
  assert.deepEqual(ctx.calls, ["resume", "suspend"]);
});

test("a resume left pending is retried on the next gesture, and only a recent cue plays", async (context) => {
  context.after(restoreGlobals);
  const { Suspendable, log, made } = suspendableContext();
  class OffGesture extends Suspendable {
    state = "suspended";
  }
  manualTimers();
  let now = 10_000;
  const win = listeningWindow(OffGesture);
  setGlobal("performance", { now: () => now });
  setGlobal("navigator", { userActivation: { hasBeenActive: true } });
  setGlobal("window", win);
  const { play } = await import(`../dist/audio/engine.js?pending=${Date.now()}`);
  const { THEMES } = await import("../dist/sounds/themes.js");
  const { arrangement } = await import("../dist/sounds/context.js");

  // played off a gesture's stack (after an await, a drag library's callback): resume stays pending
  play("tap");
  const ctx = made[0];
  assert.deepEqual(listening(win), GESTURES);
  now += 1_001;
  play("success");
  assert.deepEqual(listening(win), GESTURES, "armed once");

  // the next gesture resumes on its own stack; the browser settles every pending resume
  win.emit("click");
  assert.deepEqual(ctx.calls, ["resume", "resume", "resume"]);
  now += 500;
  ctx.settle();
  await flush();
  // tap waited 1.5 s and is dropped; success waited 0.5 s and plays
  assert.equal(log.sources.length, arrangement(THEMES.default.success.layers, "normal").length);
  assert.deepEqual(win.listeners, []);

  // running now: a play renders straight away and arms nothing
  play("tap");
  assert.ok(log.sources.length > arrangement(THEMES.default.success.layers, "normal").length);
  assert.deepEqual(win.listeners, []);
});

test("without Web Audio, or a window that can't listen, nothing is armed", async (context) => {
  context.after(restoreGlobals);
  const win = listeningWindow(undefined);
  setGlobal("navigator", { userActivation: { hasBeenActive: false } });
  setGlobal("window", win);
  const bare = await import(`../dist/audio/engine.js?bare=${Date.now()}`);
  bare.play("tap");
  bare.warm();
  assert.deepEqual(win.listeners, []);

  const { Suspendable } = suspendableContext();
  setGlobal("window", { AudioContext: Suspendable, addEventListener() {} });
  const deaf = await import(`../dist/audio/engine.js?deaf=${Date.now()}`);
  assert.doesNotThrow(() => deaf.play("tap"));
  assert.doesNotThrow(() => deaf.warm());
});

test("warm builds the shared graph and starts the context without a sound", async (context) => {
  context.after(restoreGlobals);
  const { Suspendable, log, made } = suspendableContext();
  let compressors = 0;
  class Cold extends Suspendable {
    state = "suspended";
    createDynamicsCompressor() {
      compressors++;
      return super.createDynamicsCompressor();
    }
  }
  const timers = manualTimers();
  const userActivation = { hasBeenActive: false };
  const win = listeningWindow(Cold);
  setGlobal("window", undefined);
  const { warm, setEnabled, play } = await import(`../dist/audio/engine.js?warm=${Date.now()}`);
  assert.doesNotThrow(() => warm(), "no window: nothing to do");

  setGlobal("navigator", { userActivation });
  setGlobal("window", win);
  setEnabled(false);
  warm();
  setEnabled(true);
  assert.equal(made.length, 0, "switched off");
  assert.deepEqual(win.listeners, []);
  warm();
  assert.equal(made.length, 0, "before activation");

  userActivation.hasBeenActive = true;
  warm();
  warm();
  const ctx = made[0];
  assert.equal(made.length, 1);
  assert.equal(compressors, 1, "the output and room are built once");
  assert.equal(log.sources.length, 0, "no source is started");
  assert.deepEqual(ctx.calls, ["resume", "resume"]);
  ctx.settle();
  await flush();
  assert.deepEqual(win.listeners, []);

  // running and idle: warm doesn't hold the device open
  warm();
  assert.equal(ctx.calls.length, 2);
  timers.tick(1000);
  assert.deepEqual(ctx.calls, ["resume", "resume", "suspend"]);
  ctx.settle();
  await flush();

  // the first cue after it renders on the graph warm built
  play("tap");
  ctx.settle();
  await flush();
  assert.ok(log.sources.length > 0);
  assert.equal(compressors, 1);
});

test("an interrupted context, as Safari leaves one after a screen lock, starts again on the next gesture", async (context) => {
  context.after(restoreGlobals);
  const { Suspendable, log, made } = suspendableContext();
  manualTimers();
  const win = listeningWindow(Suspendable);
  setGlobal("navigator", { userActivation: { hasBeenActive: true } });
  setGlobal("window", win);
  const { play } = await import(`../dist/audio/engine.js?interrupted=${Date.now()}`);

  play("tap");
  const ctx = made[0];
  ctx.state = "interrupted";
  // resume() outside a gesture stays pending, so the next gesture tries again
  const before = log.sources.length;
  play("tap");
  assert.equal(log.sources.length, before);
  assert.deepEqual(listening(win), GESTURES);
  win.emit("click");
  assert.deepEqual(ctx.calls, ["resume", "resume"]);
  ctx.settle();
  await flush();
  assert.deepEqual(win.listeners, []);

  // and later plays render straight away, on the same context
  const resumed = log.sources.length;
  play("success");
  assert.ok(log.sources.length > resumed);
  assert.equal(made.length, 1);
});

test("a closed context is dropped, and the next play builds a fresh one", async (context) => {
  context.after(restoreGlobals);
  const { Suspendable, log, made } = suspendableContext();
  let compressors = 0;
  class Counting extends Suspendable {
    createDynamicsCompressor() {
      compressors++;
      return super.createDynamicsCompressor();
    }
  }
  const timers = manualTimers();
  const win = listeningWindow(Counting);
  setGlobal("navigator", { userActivation: { hasBeenActive: true } });
  setGlobal("window", win);
  const { play } = await import(`../dist/audio/engine.js?closed=${Date.now()}`);

  play("tap");
  const old = log.sources.slice();
  made[0].state = "closed";
  play("tap");
  assert.equal(made.length, 2);
  assert.equal(compressors, 2, "the output, room and noise are rebuilt on the new context");
  assert.ok(log.sources.length > old.length);

  // the old play ending late doesn't count against the new one, which still sounds
  for (const source of old) source.onended();
  timers.tick(1000);
  assert.deepEqual(made[1].calls, []);
  for (const source of log.sources.slice(old.length)) source.onended();
  timers.tick(1000);
  assert.deepEqual(made[1].calls, ["suspend"]);
  assert.deepEqual(made[0].calls, []);
});
