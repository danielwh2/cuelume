# Cuelume

Seventeen carefully designed interaction sounds for the web. Synthesized live with Web Audio, with no audio files and zero runtime dependencies.

Cuelume is a curated sound palette, not an audio engine. It gives buttons, links, toggles, and completed actions clear feedback without asking developers to design sounds themselves. Add an attribute, call `bind()`, done.

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
<button data-cuelume-press data-cuelume-release>Save</button>
<a data-cuelume-hover="tick">Docs</a>
<button data-cuelume-toggle>Dark mode</button>
<button data-cuelume-press="pulse" data-cuelume-release="scan">Launch</button>
```

Then wire everything up once:

```ts
import { bind } from "cuelume";

bind();
```

| Attribute              | Fires on       | Default sound |
| ---------------------- | -------------- | ------------- |
| `data-cuelume-hover`   | `pointerenter` | `chime`       |
| `data-cuelume-press`   | `pointerdown`  | `press`       |
| `data-cuelume-release` | `pointerup`    | `release`     |
| `data-cuelume-toggle`  | `click`        | `toggle`      |

Leave the attribute value empty to use the default, or set it to any sound name.

Prefer code? Play sounds imperatively:

```ts
import { play } from "cuelume";

await navigator.clipboard.writeText(text);
play("success");
play("success", { volume: 0.4 }); // quieter for this play only
```

Need sound preferences? Your app owns the settings; Cuelume only applies them:

```ts
import { setEnabled, setVolume } from "cuelume";

setVolume(0.7);    // global multiplier, clamped to 0–1
setEnabled(false); // future play attempts become no-ops
setEnabled(true);  // enable playback again
```

Cuelume starts enabled at full volume and does not read or write storage.

## Sounds

| Name      | Character                    | Suggested use                    |
| --------- | ---------------------------- | -------------------------------- |
| `chime`   | Soft two-note ascending bell | Default hover                    |
| `sparkle` | Quick four-note twinkle      | Playful accents                  |
| `droplet` | Single note gliding down     | Dismiss, collapse                |
| `bloom`   | Warm slow swell              | Reveal, expand                   |
| `whisper` | Soft hush with a falling tone | Tooltips and quiet previews      |
| `tick`    | Crisp instant tick           | Nav and menu hover               |
| `press`   | Dull muted knock             | Pointer down                     |
| `release` | Brighter springy tick        | Pointer up                       |
| `toggle`  | Mechanical click-clack       | Switches, tabs                   |
| `success` | Warm three-note confirmation | After an action succeeds (e.g. copy to clipboard) |
| `error`   | Soft knock and descending refusal | Recoverable errors          |
| `page`    | Papery flick with a glass tick | Pages, galleries, carousels    |
| `loading` | Brief unresolved rising shimmer | User-initiated work starting  |
| `ready`   | Rising lock-on with a clear resolve | Content or system ready     |
| `pulse`   | Compact synthetic chirp         | Primary buttons and controls  |
| `scan`    | Fast three-step locator signal  | Menus and secondary buttons   |
| `arrival` | Rising harmonic portal          | Client-side page arrivals     |

## API

```ts
import { play, prime, bind, setEnabled, setVolume, sounds, type SoundName } from "cuelume";
```

- **`play(name?: SoundName, options?: { volume?: number })`** — play a sound immediately. Defaults to `"chime"`; `options.volume` controls this play only.
- **`prime()`** — create and start the shared `AudioContext` without playing anything. Call it from a `click`, `touchend`, `keydown` or `mousedown` handler when the first cue of a visit will come from somewhere the browser does not treat as a gesture (a swipe, a drag library's pointer callbacks, a frame callback, the continuation after an `await`). Same gates as `play()`: a no-op while disabled and without Web Audio; before the first user activation it waits for the next gesture that counts.
- **`bind(root?: ParentNode)`** — delegate all `data-cuelume-*` interactions under `root` (defaults to the whole document). Idempotent and handles elements added later.
- **`setEnabled(enabled: boolean)`** — enable or disable future playback. Does not persist the preference or stop sounds already playing.
- **`setVolume(volume: number)`** — set the global volume for future playback, clamped to `0–1`. Non-finite values are ignored and preferences are not persisted.
- **`sounds`** — the list of all sound names.
- **`SoundName`** — union type of the seventeen sound names.

## Defaults that behave

- **Pointer-aware.** Hover requires a fine mouse pointer. Press and release support mouse, touch, and pen; toggle follows native click activation, including keyboard.
- **Hover repeat guard.** Hover sounds are globally throttled to one every 150ms, so sweeping across a menu stays quiet.
- **Audible without clipping.** One shared boosted output stage keeps sounds clear, with native compression protecting overlapping cues.
- **One lazy `AudioContext`.** Shared across all sounds, created on first use.
- **Autoplay-friendly.** Attempts to resume suspended audio without surfacing errors when a browser blocks it.
- **Starts on the next real gesture.** WebKit grants a page user activation only for a touch that ends as a tap, never for a swipe, and starts audio only from the call stack of a `touchend`, `click` or `keydown`. A first cue played from a swipe, a drag library's `pointerup`, a frame callback or the continuation after an `await` is therefore blocked. Cuelume then listens once, in the capture phase on `window`, for the next `touchend`, `click`, `keydown` or `mousedown` that counts, and creates and starts the context there, so every cue after it plays. A cue blocked before the page's first activation is dropped; one left waiting on a pending `resume()` plays if that gesture comes within a second, else it is dropped rather than burst out late. Nothing is left listening once the context runs. `prime()` lets an app start the context from a gesture of its own choosing.
- **SSR-safe.** Importing on the server is a no-op.
- **Safe fallback.** Invalid runtime names and unavailable or blocked Web Audio make `play()` a silent no-op.
- **Dynamic, idempotent binding.** `bind()` never double-attaches listeners, and later DOM additions, removals, and clones work automatically.

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
document.addEventListener("astro:page-load", () => play("arrival"));
```

Browsers block audio on a fresh visit until the user interacts with the page. The arrival cue therefore plays on client-side navigations after that first interaction.

## License

MIT
