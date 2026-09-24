# Cuelume

Nine interaction cues for the web, in two themes. Synthesized live with Web Audio, with no audio files and zero runtime dependencies.

Cuelume is a compact interaction-sound system, not an audio engine. Names describe interface jobs (`tap`, `open`, `success`), so buttons, fields, menus, and completed actions get clear feedback without anyone designing sounds. Add an attribute, call `bind()`, done.

## Install

```sh
npm install cuelume
```

## Requirements

Cuelume is ESM-only. Use it through native `import` or an ESM-compatible bundler; CommonJS `require()` is not supported.

It targets modern browsers with ES modules and the Web Audio API. Server-side imports are safe, but sound playback only runs in the browser.

## Quick start

Add data attributes to your markup:

```html
<button data-cuelume-tap>Save</button>
<input data-cuelume-type placeholder="Search" />
<select data-cuelume-select>…</select>
<button data-cuelume-toggle>Dark mode</button>
<button data-cuelume-open>Open menu</button>
<a href="/docs" data-cuelume-navigate>Docs</a>
```

Then wire everything up once:

```ts
import { bind } from "cuelume";

bind();
```

| Attribute                | Fires on                                 | Default cue |
| ------------------------ | ---------------------------------------- | ----------- |
| `data-cuelume-tap`       | `click`                                  | `tap`       |
| `data-cuelume-type`      | eligible `keydown`                       | `type`      |
| `data-cuelume-select`    | `change` on a native `<select>`, otherwise `click` | `select` |
| `data-cuelume-toggle`    | `click`                                  | `toggle`    |
| `data-cuelume-open`      | `click`                                  | `open`      |
| `data-cuelume-close`     | `click`                                  | `close`     |
| `data-cuelume-navigate`  | `click`                                  | `navigate`  |

Leave the attribute value empty to use the default, or set it to any cue name.

Outcome cues follow the actual result of an operation, so play them from code:

```ts
import { play } from "cuelume";

try {
  await save();
  play("success");
} catch {
  play("error");
}

play("success", { volume: 0.4 }); // quieter for this play only
```

Need sound preferences? Your app owns the settings; Cuelume only applies them:

```ts
import { setEnabled, setVolume, setTheme } from "cuelume";

setVolume(0.7);     // global multiplier, clamped to 0–1
setEnabled(false);  // future play attempts become no-ops
setTheme("mech");   // dry and mechanical instead of warm and tactile
```

Cuelume starts enabled, at full volume, in the `default` theme, and does not read or write storage.

## Cues

| Cue        | Job                                              | `default`                                   | `mech`                                    |
| ---------- | ------------------------------------------------ | ------------------------------------------- | ----------------------------------------- |
| `tap`      | Buttons, links, and direct activation            | Compact tactile pop with a low thud         | Resonant dry click with a tight thud      |
| `type`     | Text-entry feedback                              | Soft rounded keycap, slightly varied each time | Keycap top and bottom-out, slightly varied |
| `select`   | Dropdown, menu, and list selection               | Short precise glass pluck, like a detent    | One precise ratchet click                 |
| `toggle`   | Switching between states                         | Two-part click-clack with body              | Relay: click, then a tighter clack        |
| `open`     | Menus, drawers, dialogs, and disclosures opening | Gooey elastic stretch that pops open        | Latch releasing on a rising sweep         |
| `close`    | Closing or dismissing UI                         | Short soft suction that lands               | Latch closing on a falling sweep          |
| `success`  | Confirmed completion                             | Warm restrained two-note glass resolve      | Two precise notes and a click             |
| `error`    | Recoverable failure or refusal                   | Soft knock and two descending tones         | Low knock and two short descending tones  |
| `navigate` | Route, page, carousel, or gallery movement       | Papery flick across the stereo field        | Slider travelling left to right           |

Every pitched cue is tuned to A major, so overlapping cues harmonize instead of clashing. Both themes are level-matched.

## API

```ts
import {
  play, bind, setEnabled, setVolume, setTheme,
  sounds, themes,
  type SoundName, type ThemeName,
} from "cuelume";
```

- **`play(name?: SoundName, options?: { volume?: number })`** — play a cue immediately in the active theme. Defaults to `"tap"`; `options.volume` controls this play only.
- **`bind(root?: ParentNode)`** — delegate all `data-cuelume-*` interactions under `root` (defaults to the whole document). Idempotent and handles elements added later.
- **`setEnabled(enabled: boolean)`** — enable or disable future playback. Does not persist the preference or stop sounds already playing.
- **`setVolume(volume: number)`** — set the global volume for future playback, clamped to `0–1`. Non-finite values are ignored.
- **`setTheme(theme: ThemeName)`** — switch the theme for future playback. Unknown names are ignored; nothing is persisted.
- **`sounds`** — the nine cue names, in catalog order.
- **`themes`** — `["default", "mech"]`.
- **`SoundName`**, **`ThemeName`** — union types of the above.

## Defaults that behave

- **Typing stays restrained.** Only elements marked `data-cuelume-type` play. Password fields, modifier keys, shortcut chords, composition, and held-key repeats are silent, and rapid input is rate-limited. Each keystroke is detuned a little so fast typing never sounds machine-stamped.
- **Selection plays once.** A native `<select>` plays on `change`, not when opened. A custom option plays on its activation click, so keyboard activation sounds the same.
- **One key, one room.** Every pitched cue sits in A major, and cues that want air share one small synthesized room rather than each carrying an echo.
- **Audible without clipping.** One shared boosted output stage keeps cues clear, with native compression protecting overlapping cues.
- **One lazy `AudioContext`.** Shared across all cues, created on first use.
- **Autoplay-friendly.** Attempts to resume suspended audio without surfacing errors when a browser blocks it.
- **SSR-safe.** Importing on the server is a no-op.
- **Safe fallback.** Invalid runtime names and unavailable or blocked Web Audio make `play()` a silent no-op.
- **Dynamic, idempotent binding.** `bind()` never double-attaches listeners, and later DOM additions, removals, and clones work automatically.

## Migrating from 0.2

The seventeen 0.2 names still work in `play()` for this release, mapped to the cue that does the same job. `sounds` lists only the nine canonical names. The mapping is for compatibility, not a claim that every old cue has an exact equivalent.

| 0.2 name  | Now        | 0.2 name  | Now        |
| --------- | ---------- | --------- | ---------- |
| `chime`   | `success`  | `error`   | `error`    |
| `sparkle` | `success`  | `page`    | `navigate` |
| `droplet` | `close`    | `loading` | `open`     |
| `bloom`   | `open`     | `ready`   | `success`  |
| `whisper` | `select`   | `pulse`   | `tap`      |
| `tick`    | `select`   | `scan`    | `select`   |
| `press`   | `tap`      | `arrival` | `navigate` |
| `release` | `select`   | `toggle`  | `toggle`   |

`data-cuelume-hover` (fine mouse pointer only, throttled to one play every 150ms), `data-cuelume-press`, and `data-cuelume-release` also keep working for this release, defaulting to `select`, `tap`, and `select`. Hover is not part of the canonical bindings: passive exploration is too easy to make noisy. Prefer `data-cuelume-tap` on the element itself.

## Frameworks

Cuelume works anywhere HTML does — plain pages, Astro, React, Vue. Call `bind()` once after the DOM is ready. Delegated listeners keep working when components or routes replace descendants.

React:

```tsx
useEffect(() => {
  bind();
}, []);
```

Astro (with view transitions):

```js
import { bind, play } from "cuelume";

bind();
document.addEventListener("astro:page-load", () => play("navigate"));
```

Browsers block audio on a fresh visit until the user interacts with the page. The navigate cue therefore plays on client-side navigations after that first interaction.

## License

MIT
