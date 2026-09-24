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
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
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

class AudioNodeStub {
  constructor(name = "node") {
    this.name = name;
    this.connections = [];
  }
  connect(destination) {
    this.connections.push(destination);
    return destination;
  }
  disconnect() {}
}

/** A working context that counts what the engine creates. */
function workingContext(counts = {}) {
  return class WorkingContext {
    state = "running";
    currentTime = 0;
    sampleRate = 1;
    destination = new AudioNodeStub("destination");
    createGain() {
      const gain = Object.assign(new AudioNodeStub("gain"), { gain: audioParam() });
      counts.gains?.push(gain);
      return gain;
    }
    createDynamicsCompressor() {
      return compressor(new AudioNodeStub("compressor"));
    }
    createConvolver() {
      return Object.assign(new AudioNodeStub("convolver"), { buffer: null });
    }
    createStereoPanner() {
      return Object.assign(new AudioNodeStub("panner"), { pan: audioParam() });
    }
    createOscillator() {
      return Object.assign(new AudioNodeStub("oscillator"), {
        frequency: audioParam(),
        detune: audioParam(),
        start() {
          if (counts.oscillators !== undefined) counts.oscillators++;
        },
        stop() {},
      });
    }
    createBuffer(channels) {
      if (channels === 1 && counts.buffers !== undefined) counts.buffers++;
      return { getChannelData: () => new Float32Array(1) };
    }
    createBufferSource() {
      return Object.assign(new AudioNodeStub("buffer-source"), { buffer: null, start() {}, stop() {} });
    }
    createBiquadFilter() {
      return Object.assign(new AudioNodeStub("filter"), { frequency: audioParam(), Q: audioParam() });
    }
  };
}

function noiseLayers(recipe) {
  return recipe.layers.filter((layer) => layer.kind === "noise").length;
}

function toneLayers(recipe) {
  return recipe.layers.filter((layer) => layer.kind === "tone").length;
}

test("the palette is nine canonical cues in two themes", async () => {
  const { setTheme, setVolume, sounds, themes } = await import("../dist/index.js");
  assert.deepEqual(sounds, ["tap", "type", "select", "toggle", "open", "close", "success", "error", "navigate"]);
  assert.deepEqual(themes, ["default", "mech"]);
  assert.equal(typeof setVolume, "function");
  assert.equal(typeof setTheme, "function");
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

test("legacy names resolve to canonical cues and themes switch future playback", async (context) => {
  context.after(restoreGlobals);
  const counts = { oscillators: 0, buffers: 0 };
  setGlobal("setTimeout", () => 0);
  setGlobal("window", { AudioContext: workingContext(counts) });

  const { play, setTheme } = await import(`../dist/audio/engine.js?themes=${Date.now()}`);
  const { LEGACY_SOUNDS, THEMES } = await import("../dist/sounds/recipes.js");

  const tap = THEMES.default.tap;
  play("press");
  assert.equal(counts.oscillators, toneLayers(tap));
  assert.equal(counts.buffers, noiseLayers(tap));
  assert.equal(LEGACY_SOUNDS.chime, "success");

  counts.oscillators = 0;
  counts.buffers = 0;
  setTheme("mech");
  setTheme("nope");
  play("tap");
  assert.equal(counts.oscillators, toneLayers(THEMES.mech.tap));
  assert.equal(counts.buffers, noiseLayers(THEMES.mech.tap));

  counts.oscillators = 0;
  setTheme("default");
  play("tap");
  assert.equal(counts.oscillators, toneLayers(tap));
});

test("volume is clamped and one boosted output bus is reused", async (context) => {
  context.after(restoreGlobals);
  const gains = [];
  const compressors = [];

  class VolumeContext extends workingContext({ gains }) {
    createDynamicsCompressor() {
      const node = compressor(new AudioNodeStub("compressor"));
      compressors.push(node);
      return node;
    }
  }

  setGlobal("setTimeout", () => 0);
  setGlobal("window", { AudioContext: VolumeContext });

  const { play, setVolume } = await import(`../dist/audio/engine.js?volume=${Date.now()}`);
  const { THEMES } = await import("../dist/sounds/recipes.js");
  const base = THEMES.default.tap.masterGain;

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
    [base * 0.5, base * 0.25, base * 0.5, base * 0.5],
  );
  assert.ok(output.gain.value > 1);
  assert.equal(compressors.length, 1);
  assert.deepEqual(output.connections, [compressors[0]]);
  assert.equal(compressors[0].connections.length, 1);
  assert.equal(compressors[0].connections[0].name, "destination");
});

class FakeElement {
  constructor(parent = null, tagName = "DIV") {
    this.parent = parent;
    this.tagName = tagName;
    this.attributes = new Map();
    this.listeners = new Map();
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  emit(type, target = this, options = {}) {
    const event = { target, relatedTarget: null, pointerType: "mouse", ...options };
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
    const attribute = selector.slice(1, -1);
    for (let element = this; element; element = element.parent) {
      if (element.hasAttribute(attribute)) return element;
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

// bind.js imports the engine without a cache-busting query, so every binding
// test shares one engine and one AudioContext: they must share the counters too.
const bindingCounts = { buffers: 0, oscillators: 0 };

async function bindingFixture(context) {
  context.after(restoreGlobals);
  const counts = bindingCounts;
  counts.buffers = 0;
  counts.oscillators = 0;
  const clock = { now: 1_000 };
  setGlobal("Element", FakeElement);
  setGlobal("Node", FakeElement);
  setGlobal("document", {});
  setGlobal("performance", { now: () => clock.now });
  setGlobal("setTimeout", () => 0);
  setGlobal("window", {
    AudioContext: workingContext(counts),
    matchMedia: () => ({ matches: true }),
  });

  const root = new FakeElement();
  const { bind } = await import(`../dist/interactions/bind.js?binding=${Date.now()}-${Math.random()}`);
  bind(root);
  return { root, clock, bind, counts };
}

test("binding is delegated, dynamic, idempotent, and globally throttled", async (context) => {
  const { root, clock, bind, counts } = await bindingFixture(context);
  const { THEMES } = await import("../dist/sounds/recipes.js");
  const select = noiseLayers(THEMES.default.select);
  const tap = toneLayers(THEMES.default.tap);

  bind(root);
  bind(root);
  assert.equal(root.listeners.get("pointerenter").length, 1);
  assert.equal(root.listeners.get("pointerdown").length, 1);
  assert.equal(root.listeners.get("pointerup").length, 1);
  assert.equal(root.listeners.get("keydown").length, 1);
  assert.equal(root.listeners.get("change").length, 1);
  assert.equal(root.listeners.get("click").length, 6);

  const first = new FakeElement(root);
  first.setAttribute("data-cuelume-hover", "select");
  root.emit("pointerenter", first);
  assert.equal(counts.buffers, select);

  const later = new FakeElement(root);
  later.setAttribute("data-cuelume-hover", "select");
  clock.now += 100;
  root.emit("pointerenter", later);
  assert.equal(counts.buffers, select);

  clock.now += 51;
  root.emit("pointerenter", later);
  assert.equal(counts.buffers, 2 * select);

  later.setAttribute("data-cuelume-toggle", "select");
  root.emit("click", later, { pointerType: undefined });
  assert.equal(counts.buffers, 3 * select);
  later.removeAttribute("data-cuelume-toggle");
  root.emit("click", later, { pointerType: undefined });
  assert.equal(counts.buffers, 3 * select);

  const touchTarget = new FakeElement(root);
  touchTarget.setAttribute("data-cuelume-press", "select");
  touchTarget.setAttribute("data-cuelume-release", "select");
  root.emit("pointerdown", touchTarget, { pointerType: "touch" });
  root.emit("pointerup", touchTarget, { pointerType: "touch" });
  assert.equal(counts.buffers, 5 * select);

  const invalid = new FakeElement(root);
  invalid.setAttribute("data-cuelume-hover", "toString");
  clock.now += 151;
  root.emit("pointerenter", invalid);
  assert.equal(counts.buffers, 6 * select);

  const child = new FakeElement(later);
  clock.now += 151;
  root.emit("pointerenter", child, { relatedTarget: later });
  assert.equal(counts.buffers, 6 * select);

  const button = new FakeElement(root);
  button.setAttribute("data-cuelume-tap");
  counts.oscillators = 0;
  root.emit("click", button, { pointerType: undefined });
  assert.equal(counts.oscillators, tap);

  const both = new FakeElement(root);
  both.setAttribute("data-cuelume-tap");
  both.setAttribute("data-cuelume-open");
  counts.oscillators = 0;
  root.emit("click", both, { pointerType: undefined });
  assert.equal(counts.oscillators, tap);
});

test("typing plays once per eligible key and native selects play on change", async (context) => {
  const { root, clock, counts } = await bindingFixture(context);
  const { THEMES } = await import("../dist/sounds/recipes.js");
  const type = noiseLayers(THEMES.default.type);
  const select = noiseLayers(THEMES.default.select);

  const field = new FakeElement(root, "INPUT");
  field.setAttribute("data-cuelume-type");
  const key = (options) => root.emit("keydown", field, { key: "a", repeat: false, ...options });

  key();
  assert.equal(counts.buffers, type);
  clock.now += 10;
  key();
  assert.equal(counts.buffers, type, "rate-limited");
  clock.now += 40;
  key({ repeat: true });
  key({ metaKey: true });
  key({ ctrlKey: true });
  key({ altKey: true });
  key({ isComposing: true });
  key({ key: "Shift" });
  key({ key: "ArrowLeft" });
  assert.equal(counts.buffers, type, "ignored keys");
  key({ key: "Backspace" });
  assert.equal(counts.buffers, 2 * type);

  field.type = "password";
  clock.now += 40;
  key();
  assert.equal(counts.buffers, 2 * type, "password fields stay silent");

  const native = new FakeElement(root, "SELECT");
  native.setAttribute("data-cuelume-select");
  root.emit("click", native, { pointerType: undefined });
  assert.equal(counts.buffers, 2 * type, "opening a native select is silent");
  root.emit("change", native);
  assert.equal(counts.buffers, 2 * type + select);

  const custom = new FakeElement(root);
  custom.setAttribute("data-cuelume-select");
  root.emit("click", custom, { pointerType: undefined });
  assert.equal(counts.buffers, 2 * type + 2 * select);
});

test("finished graphs disconnect after their room tail", async (context) => {
  context.after(restoreGlobals);
  const timers = [];
  const disconnected = [];
  const nodes = new Map();

  class NamedNodeStub extends AudioNodeStub {
    constructor(name) {
      super(name);
      nodes.set(name, this);
    }
    disconnect() {
      disconnected.push(this.name);
    }
  }

  let gainCount = 0;
  class CleanupContext extends workingContext() {
    destination = new NamedNodeStub("destination");
    createGain() {
      const names = ["output", "master", "send"];
      return Object.assign(new NamedNodeStub(names[gainCount++] ?? "gain"), { gain: audioParam() });
    }
    createDynamicsCompressor() {
      return compressor(new NamedNodeStub("limiter"));
    }
    createConvolver() {
      return Object.assign(new NamedNodeStub("space"), { buffer: null });
    }
  }

  setGlobal("setTimeout", (callback, delay) => {
    timers.push({ callback, delay });
    return 0;
  });
  setGlobal("window", { AudioContext: CleanupContext });

  const { play } = await import(`../dist/audio/engine.js?cleanup=${Date.now()}`);
  const { THEMES } = await import("../dist/sounds/recipes.js");
  play("success");

  const recipe = THEMES.default.success;
  const sourceEnd = Math.max(...recipe.layers.map((l) => (l.offset ?? 0) + l.attack + l.decay + 0.05));
  assert.ok(recipe.space > 0);
  assert.equal(timers.length, 1);
  assert.equal(Math.round(timers[0].delay), Math.round((sourceEnd + 0.5 + 0.05) * 1000));
  assert.deepEqual(nodes.get("master").connections, [nodes.get("output"), nodes.get("send")]);
  assert.deepEqual(nodes.get("send").connections, [nodes.get("space")]);
  assert.deepEqual(nodes.get("space").connections, [nodes.get("output")]);
  assert.deepEqual(nodes.get("output").connections, [nodes.get("limiter")]);
  assert.deepEqual(nodes.get("limiter").connections, [nodes.get("destination")]);
  timers[0].callback();
  assert.deepEqual(disconnected, ["master", "send"]);

  play("tap");
  assert.equal(timers.length, 2);
});
