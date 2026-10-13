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

test("the room leans no cue to one side by more than 0.5 dB", async () => {
  const { THEMES, stereo, loudness } = await import("../scripts/sound.mjs");
  for (const theme of Object.keys(THEMES)) {
    for (const cue of Object.keys(THEMES[theme])) {
      for (const emphasis of ["subtle", "normal", "strong"]) {
        const [left, right] = stereo(theme, cue, { emphasis }).map(loudness);
        const lean = left - right;
        assert.ok(Math.abs(lean) <= 0.5, `${theme} ${cue} ${emphasis} leans ${lean.toFixed(2)} dB left`);
      }
    }
  }
});

test("no single cue reaches the soft clip, however hard it is struck", async () => {
  const { THEMES, render } = await import("../scripts/sound.mjs");
  const { CLIP_KNEE } = await import("../dist/audio/output.js");
  const takes = [0, 1, 2, 3];
  for (const theme of Object.keys(THEMES)) {
    for (const [cue, recipe] of Object.entries(THEMES[theme])) {
      const hardestStrike = 1 + (recipe.vary?.level ?? 0);
      const peaks = takes.map((seed) => render(theme, cue, { emphasis: "strong", seed }).reduce((max, x) => Math.max(max, Math.abs(x)), 0));
      const peak = Math.max(...peaks) * hardestStrike;
      assert.ok(peak < CLIP_KNEE, `${theme} ${cue} peaks at ${peak.toFixed(3)}`);
    }
  }
});
