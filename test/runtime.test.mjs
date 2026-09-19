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

test("expanded palette exposes sci-fi interaction and arrival cues", async () => {
  const { setVolume, sounds } = await import("../dist/index.js");
  assert.equal(sounds.length, 17);
  assert.deepEqual(sounds.slice(-3), ["pulse", "scan", "arrival"]);
  assert.equal(typeof setVolume, "function");
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

  play("chime");
  assert.equal(constructions, 0);

  userActivation.hasBeenActive = true;
  play("chime");
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
  assert.doesNotThrow(() => play("chime"));
  assert.equal(constructions, 0);
  setEnabled(true);
  assert.doesNotThrow(() => play("chime"));
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
  assert.doesNotThrow(() => rejected.play("chime"));
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
  deferred.play("chime");
  deferred.setEnabled(false);
  finishResume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renders, 0);

});

test("volume is clamped and one boosted output bus is reused", async (context) => {
  context.after(restoreGlobals);
  const gains = [];
  const compressors = [];
  const bufferSources = [];

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
    createDynamicsCompressor() {
      const node = compressor(new AudioNodeStub("compressor"));
      compressors.push(node);
      return node;
    }
    createBuffer() {
      return { getChannelData: () => new Float32Array(1) };
    }
    createBufferSource() {
      const source = Object.assign(new AudioNodeStub("buffer-source"), {
        buffer: null,
        start() {},
        stop() {},
      });
      bufferSources.push(source);
      return source;
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

  setVolume(2);
  play("press", { volume: 0.5 });
  bufferSources[0].onended();
  setVolume(0.5);
  play("press", { volume: 0.5 });
  play("press", { volume: 2 });
  play("press", { volume: Number.NaN });
  setVolume(-1);
  setVolume(Number.NaN);
  setVolume(Number.POSITIVE_INFINITY);
  play("press");

  const output = gains[0];
  const masters = gains.slice(1).filter((gain) => gain.connections.includes(output));

  assert.deepEqual(
    masters.map(({ gain }) => gain.value),
    [0.2, 0.1, 0.2, 0.2],
  );
  assert.ok(output.gain.value > 1);
  assert.equal(compressors.length, 1);
  assert.deepEqual(output.connections, [compressors[0]]);
  assert.equal(compressors[0].connections.length, 1);
  assert.equal(compressors[0].connections[0].name, "destination");
});

test("the renderer is primed before short cues are scheduled", async (context) => {
  context.after(restoreGlobals);
  const sourceStarts = [];
  const sourceStops = [];
  const sources = [];
  const buffers = [];
  const envelopeEvents = [];
  const timers = [];

  class AudioNodeStub {
    connect(destination) {
      return destination;
    }
    disconnect() {}
  }

  let gainCount = 0;
  class SchedulingContext {
    state = "running";
    currentTime = 7;
    sampleRate = 48_000;
    destination = new AudioNodeStub();
    createGain() {
      gainCount++;
      const recordsEnvelope = gainCount === 3;
      return Object.assign(new AudioNodeStub(), {
        gain: {
          value: 0,
          setValueAtTime(value, time) {
            if (recordsEnvelope) envelopeEvents.push(["set", value, time]);
          },
          exponentialRampToValueAtTime(value, time) {
            if (recordsEnvelope) envelopeEvents.push(["ramp", value, time]);
          },
        },
      });
    }
    createDynamicsCompressor() {
      return compressor(new AudioNodeStub());
    }
    createBuffer(channels, length, sampleRate) {
      buffers.push([channels, length, sampleRate]);
      return { getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() {
      const source = Object.assign(new AudioNodeStub(), {
        buffer: null,
        start(time) {
          sourceStarts.push(time);
        },
        stop(time) {
          sourceStops.push(time);
        },
      });
      sources.push(source);
      return source;
    }
    createBiquadFilter() {
      return Object.assign(new AudioNodeStub(), {
        frequency: audioParam(),
        Q: audioParam(),
      });
    }
  }

  setGlobal("setTimeout", (callback, delay) => {
    timers.push({ callback, delay });
    return 0;
  });
  setGlobal("window", { AudioContext: SchedulingContext });

  const { play } = await import(`../dist/audio/engine.js?scheduling=${Date.now()}`);
  play("press");

  assert.deepEqual(sourceStarts, [undefined]);
  assert.deepEqual(buffers, [[1, 960, 48_000]]);
  assert.equal(envelopeEvents.length, 0);
  sources[0].onended();
  assert.deepEqual(sourceStarts, [undefined, 7.01]);
  assert.deepEqual(buffers[1], [1, 3_408, 48_000]);
  assert.deepEqual(sourceStops, []);
  assert.deepEqual(envelopeEvents, [
    ["set", 0.0001, 7.01],
    ["ramp", 0.13, 7.011],
    ["ramp", 0.0001, 7.031],
  ]);
  assert.equal(timers.length, 0);
  sources[1].onended();
  assert.equal(Math.round(timers[0].delay), 50);
});

test("binding is delegated, dynamic, idempotent, and globally throttled", async (context) => {
  context.after(restoreGlobals);
  const counts = { buffers: 0, oscillators: 0 };

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
    createDynamicsCompressor() {
      return compressor(new AudioNodeStub());
    }
    createOscillator() {
      return Object.assign(new AudioNodeStub(), {
        frequency: audioParam(),
        detune: audioParam(),
        start() {
          counts.oscillators++;
        },
        stop() {},
      });
    }
    createBuffer() {
      counts.buffers++;
      return { getChannelData: () => new Float32Array(1) };
    }
    createBufferSource() {
      return Object.assign(new AudioNodeStub(), {
        buffer: null,
        start() {
          this.onended?.();
        },
        stop() {},
      });
    }
    createBiquadFilter() {
      return Object.assign(new AudioNodeStub(), { frequency: audioParam(), Q: audioParam() });
    }
    createDelay() {
      return Object.assign(new AudioNodeStub(), { delayTime: audioParam() });
    }
  }

  class FakeElement {
    constructor(parent = null) {
      this.parent = parent;
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

  let now = 1_000;
  setGlobal("Element", FakeElement);
  setGlobal("Node", FakeElement);
  setGlobal("document", {});
  setGlobal("performance", { now: () => now });
  setGlobal("setTimeout", () => 0);
  setGlobal("window", {
    AudioContext: WorkingContext,
    matchMedia: () => ({ matches: true }),
  });

  const root = new FakeElement();
  const { bind } = await import(`../dist/interactions/bind.js?binding=${Date.now()}`);
  bind(root);
  bind(root);
  assert.equal(root.listeners.get("pointerenter").length, 1);
  assert.equal(root.listeners.get("pointerdown").length, 1);
  assert.equal(root.listeners.get("pointerup").length, 1);
  assert.equal(root.listeners.get("click").length, 1);

  const first = new FakeElement(root);
  first.setAttribute("data-cuelume-hover", "whisper");
  root.emit("pointerenter", first);
  assert.equal(counts.buffers, 2);

  const later = new FakeElement(root);
  later.setAttribute("data-cuelume-hover", "whisper");
  now += 100;
  root.emit("pointerenter", later);
  assert.equal(counts.buffers, 2);

  now += 51;
  root.emit("pointerenter", later);
  assert.equal(counts.buffers, 3);

  later.setAttribute("data-cuelume-toggle", "whisper");
  root.emit("click", later, { pointerType: undefined });
  assert.equal(counts.buffers, 4);
  later.removeAttribute("data-cuelume-toggle");
  root.emit("click", later, { pointerType: undefined });
  assert.equal(counts.buffers, 4);

  const touchTarget = new FakeElement(root);
  touchTarget.setAttribute("data-cuelume-press", "whisper");
  touchTarget.setAttribute("data-cuelume-release", "whisper");
  root.emit("pointerdown", touchTarget, { pointerType: "touch" });
  root.emit("pointerup", touchTarget, { pointerType: "touch" });
  assert.equal(counts.buffers, 6);

  const invalid = new FakeElement(root);
  invalid.setAttribute("data-cuelume-hover", "toString");
  const oscillatorsBeforeInvalid = counts.oscillators;
  now += 151;
  root.emit("pointerenter", invalid);
  assert.equal(counts.oscillators, oscillatorsBeforeInvalid + 2);

  const child = new FakeElement(later);
  now += 151;
  root.emit("pointerenter", child, { relatedTarget: later });
  assert.equal(counts.buffers, 6);

});

test("finished shimmer graphs disconnect after their audible tail", async (context) => {
  context.after(restoreGlobals);
  const timers = [];
  const disconnected = [];
  const nodes = new Map();
  const sources = [];

  class AudioNodeStub {
    constructor(name) {
      this.name = name;
      this.connections = [];
      nodes.set(name, this);
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
  class CleanupContext {
    state = "running";
    currentTime = 0;
    sampleRate = 1;
    destination = new AudioNodeStub("destination");
    createGain() {
      const names = ["output", "master", "feedback-gain", "wet-gain", "tone-gain", "tone-gain"];
      return Object.assign(new AudioNodeStub(names[gainCount++] ?? "gain"), { gain: audioParam() });
    }
    createDynamicsCompressor() {
      return compressor(new AudioNodeStub("limiter"));
    }
    createDelay() {
      return Object.assign(new AudioNodeStub("delay"), { delayTime: audioParam() });
    }
    createBiquadFilter() {
      return Object.assign(new AudioNodeStub("feedback-filter"), {
        frequency: audioParam(),
        Q: audioParam(),
      });
    }
    createBuffer() {
      return { getChannelData: () => new Float32Array(1) };
    }
    createBufferSource() {
      return Object.assign(new AudioNodeStub("primer"), {
        buffer: null,
        start() {
          this.onended?.();
        },
      });
    }
    createOscillator() {
      const source = Object.assign(new AudioNodeStub("oscillator"), {
        frequency: audioParam(),
        detune: audioParam(),
        start() {},
        stop() {},
      });
      sources.push(source);
      return source;
    }
  }

  setGlobal("setTimeout", (callback, delay) => {
    timers.push({ callback, delay });
    return 0;
  });
  setGlobal("window", { AudioContext: CleanupContext });

  const { play } = await import(`../dist/audio/engine.js?cleanup=${Date.now()}`);
  play("chime");

  assert.equal(timers.length, 0);
  sources[0].onended();
  assert.equal(timers.length, 0);
  sources[1].onended();
  assert.equal(timers.length, 1);
  assert.equal(Math.round(timers[0].delay), 770);
  assert.equal(nodes.get("master").connections.includes(nodes.get("output")), true);
  assert.equal(nodes.get("wet-gain").connections.includes(nodes.get("output")), true);
  assert.deepEqual(nodes.get("output").connections, [nodes.get("limiter")]);
  assert.deepEqual(nodes.get("limiter").connections, [nodes.get("destination")]);
  timers[0].callback();
  assert.deepEqual(disconnected, ["master", "delay", "feedback-filter", "feedback-gain", "wet-gain"]);

  play("chime");
  assert.equal(timers.length, 1);
});
