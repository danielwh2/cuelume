/**
 * Cuelume — curated interaction cues synthesized via the Web Audio API.
 * No audio files, no dependencies, one shared `AudioContext`.
 *
 * Declarative:
 *   import { bind } from "cuelume";
 *   bind(); // wires up all data-cuelume-* attributes
 *
 * Imperative:
 *   import { play, setTheme } from "cuelume";
 *   play("success");
 *   setTheme("mech");
 */

export type { SoundName, LegacySoundName, ThemeName } from "./sounds/recipes.js";
export { sounds, themes } from "./sounds/recipes.js";
export { play, setEnabled, setVolume, setTheme } from "./audio/engine.js";
export { bind } from "./interactions/bind.js";
