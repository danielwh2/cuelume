import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// The one real-browser check: every other test drives a Web Audio stub, so
// only this one can prove Cuelume honours Chromium's autoplay policy —
// silent, with no AudioContext at all, before the first interaction, and
// sounding from that first interaction on a single shared context.
// Needs a browser once: `npx playwright-core install chromium`.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Long enough for the page to load and take its own snapshot, 350 ms in, on a slow runner. */
const SETTLE_MS = 2_000;

const PAGE = `<!doctype html>
<button data-cuelume-tap>Save</button>
<script type="module">
  // The autoplay policy as this page actually meets it, recorded at load
  // before any test-driver call can count as an interaction.
  window.__rawState = (() => {
    const context = new AudioContext();
    const state = context.state;
    void context.close();
    return state;
  })();
  window.__probe = { contexts: 0, starts: 0 };
  window.__live = [];
  const RealAudioContext = window.AudioContext;
  window.AudioContext = class extends RealAudioContext {
    constructor(...args) {
      super(...args);
      window.__probe.contexts++;
      window.__live.push(this);
    }
  };
  for (const node of [OscillatorNode, AudioBufferSourceNode]) {
    const start = node.prototype.start;
    node.prototype.start = function (...args) {
      window.__probe.starts++;
      return start.apply(this, args);
    };
  }
  const cuelume = await import("/dist/index.js");
  cuelume.bind();
  window.__cuelume = cuelume;
  // A play attempt with no interaction, timed by the page itself: driving
  // it from the test would count as a user gesture and unlock the very
  // policy under test. The frozen snapshot is what the test asserts on.
  setTimeout(() => {
    cuelume.play("success");
    setTimeout(() => {
      window.__before = { ...window.__probe };
    }, 300);
  }, 50);
</script>`;

function serve() {
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(PAGE);
        return;
      }
      const file = path.join(ROOT, request.url);
      if (!file.startsWith(ROOT)) throw new Error("outside root");
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("real Chromium: silent before interaction, sounds on first click, one shared context", { timeout: 60_000 }, async (t) => {
  let browser;
  try {
    // Headless Chromium otherwise lets audio run uninvited; this flag makes
    // it enforce the same autoplay policy a visitor's browser applies.
    browser = await chromium.launch({
      args: ["--autoplay-policy=document-user-activation-required"],
      // Playwright's defaults allow autoplay for test convenience; drop that.
      ignoreDefaultArgs: ["--autoplay-policy=no-user-gesture-required"],
    });
  } catch (error) {
    // Skipped when no browser is installed, unless CI asked for it by name.
    if (String(error).includes("Executable doesn't exist") && !process.env.CUELUME_BROWSER_REQUIRED) {
      t.skip("Chromium not installed; run: npx playwright-core install chromium");
      return;
    }
    throw error;
  }
  const server = await serve();
  t.after(() => {
    server.close();
    return browser.close();
  });

  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  // No evaluate/waitForFunction here: a driver call counts as a user gesture
  // in Chromium and would unlock audio before the page's own attempt runs.
  await page.waitForTimeout(SETTLE_MS);

  const probe = () =>
    page.evaluate(() => ({ ...window.__probe, liveStates: window.__live.map((context) => context.state) }));

  // This browser really does enforce the autoplay policy at load, so the
  // silence below is the policy working, not a muted stub.
  assert.equal(await page.evaluate(() => window.__rawState), "suspended");

  // Before any interaction, the page's own play attempt started nothing.
  const before = await page.evaluate(() => window.__before);
  assert.ok(before, "page did not record its pre-interaction attempt");
  assert.equal(before.starts, 0, "play() before interaction started a source");
  assert.equal(before.contexts, 0, "play() before interaction built an AudioContext");

  // The first real click unlocks audio: sources sound on a running context.
  await page.click("button");
  await page.waitForFunction(() => window.__probe.starts > 0);
  const afterClick = await probe();
  assert.ok(afterClick.starts > 0);
  assert.ok(afterClick.contexts >= 1);
  assert.ok(afterClick.liveStates.includes("running"), "no running AudioContext after the first click");

  // Later cues reuse that context instead of building another.
  await page.evaluate(() => window.__cuelume.play("success"));
  await page.waitForFunction((starts) => window.__probe.starts > starts, afterClick.starts);
  assert.equal((await probe()).contexts, afterClick.contexts);
});
