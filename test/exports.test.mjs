import assert from "node:assert/strict";
import test from "node:test";

// The published import surface: the main entry plus the theme data tooling
// (offline renderers, ports) needs, resolved through package.json `exports`
// rather than deep dist paths. Nothing else is importable.
test("package exports resolve: main, themes, package.json", async () => {
  const main = await import("cuelume");
  assert.equal(main.sounds.length, 14);
  assert.equal(typeof main.play, "function");
  assert.equal(typeof main.bind, "function");

  const { THEMES, themes } = await import("cuelume/themes");
  assert.deepEqual(Object.keys(THEMES), [...themes]);
  for (const theme of themes) assert.deepEqual(Object.keys(THEMES[theme]), [...main.sounds], theme);

  await assert.rejects(import("cuelume/recipes"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });

  const pkg = (await import("cuelume/package.json", { with: { type: "json" } })).default;
  assert.equal(pkg.name, "cuelume");
});
