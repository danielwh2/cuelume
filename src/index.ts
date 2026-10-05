/**
 * Cuelume — curated interaction sounds synthesized via the Web Audio API.
 * No audio files, no dependencies, one shared `AudioContext`.
 *
 * Declarative:
 *   import { bind } from "cuelume";
 *   bind(); // wires up all data-cuelume-* attributes
 *
 * Imperative:
 *   import { play } from "cuelume";
 *   play("success");
 *   play("success", { emphasis: "strong" }); // weightier when it matters
 */

export type { SoundName } from "./sounds/recipes.js";
export type { Emphasis } from "./sounds/context.js";
export type { PlayOptions } from "./audio/engine.js";
export type { ThemeName } from "./sounds/themes.js";
export { themes } from "./sounds/themes.js";
export { sounds } from "./sounds/recipes.js";
export { play, setEnabled, setTheme, setVolume, warm } from "./audio/engine.js";
export { bind } from "./interactions/bind.js";
