import assert from "node:assert/strict";
import test from "node:test";

// Switching themes changes the material, not the volume: every cue is as loud as default's, as the ear
// hears it (K-weighted, loudest 100 ms). `node scripts/sound.mjs levels --write` matches a theme that drifts.
test("every cue in every theme is as loud as default's, within 1.5 dB", async () => {
  const { THEMES, levelOf } = await import("../scripts/sound.mjs");
  for (const cue of Object.keys(THEMES.default)) {
    const reference = levelOf("default", cue);
    for (const theme of Object.keys(THEMES).filter((name) => name !== "default")) {
      const off = levelOf(theme, cue) - reference;
      assert.ok(Math.abs(off) <= 1.5, `${theme} ${cue} is ${off.toFixed(1)} dB off default`);
    }
  }
});
