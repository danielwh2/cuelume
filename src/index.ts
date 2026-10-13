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
 *
 * A custom control that presses and lets go:
 *   press("tap");   // pointerdown
 *   release("tap"); // pointerup
 */

export type { SoundName } from "./sounds/recipes.js";
export type { Emphasis } from "./sounds/context.js";
export type { PlayOptions } from "./audio/engine.js";
export type { ThemeName } from "./sounds/themes.js";
export { themes } from "./sounds/themes.js";
export { sounds } from "./sounds/recipes.js";
export { play, press, release, setEnabled, setTheme, setVolume, unlock } from "./audio/engine.js";
export { bind } from "./interactions/bind.js";
