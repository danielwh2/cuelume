# Cuelume

Fourteen interaction sounds for the web, one for each interface job. Synthesized live with Web Audio, with no audio files and zero runtime dependencies.

Cuelume is a curated sound palette, not an audio engine. It gives buttons, text fields, menus, dialogs, and finished actions clear feedback without asking developers to design sounds themselves. Add an attribute, call `bind()`, done.

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
<input data-cuelume-type placeholder="Search">
<select data-cuelume-select>…</select>
<button data-cuelume-open>Open menu</button>
<button data-cuelume-tap="open">Show details</button>
```

Then wire everything up once:

```ts
import { bind } from "cuelume";

bind();
```

| Attribute               | Fires on                                           | Default cue |
| ----------------------- | -------------------------------------------------- | ----------- |
| `data-cuelume-tap`      | `click`                                            | `tap`       |
| `data-cuelume-type`     | `keydown` that edits text                          | `type`      |
| `data-cuelume-select`   | `change` on a native select or input, else `click` | `select`    |
| `data-cuelume-toggle`   | `click`                                            | `toggle`    |
| `data-cuelume-open`     | `click`                                            | `open`      |
| `data-cuelume-close`    | `click`                                            | `close`     |
| `data-cuelume-navigate` | `click`                                            | `navigate`  |

Leave the attribute value empty to use its default cue, or set it to any cue name. When marked elements nest, the innermost one decides.

Outcome and progress cues follow what your app is actually doing, so play them from code:

```ts
import { play } from "cuelume";

play("loading");
try {
  const { warnings } = await deploy();
  play(warnings.length ? "warning" : "success");
} catch {
  play("error");
}

play("success", { volume: 0.4 }); // quieter for this play only
```

## Cues

| Cue         | Job                                   | Character                                  |
| ----------- | ------------------------------------- | ------------------------------------------ |
| `tap`       | Buttons, links, direct activation     | Small glassy tap                           |
| `type`      | Text entry                            | Keyboard keystroke, different every stroke |
| `select`    | Dropdowns, menus, lists               | Crisp woody detent                         |
| `toggle`    | Switching between states              | One crisp snap with a knock of body                       |
| `open`      | Menus, drawers, dialogs, disclosures  | Air drawing up over a light mallet note         |
| `close`     | Closing or dismissing                 | Air falling shut over a low, damped note               |
| `navigate`  | Routes, pages, carousels, galleries   | Soft whoosh that rises, and falls going back |
| `success`   | Confirmed completion                  | One soft mallet chord, C–G–E spread wide              |
| `warning`   | Done, but needs a look                | One mallet fifth, A and E              |
| `error`     | Recoverable failure or refusal        | One muted low chord, short            |
| `loading`   | Slow work started                     | One soft, low note that swells and fades   |
| `ready`     | A result is there, nothing confirmed  | One warm glass note in a small room             |
| `attention` | Blocked until the user answers        | One high glass bell, ringing longest        |
| `count`     | A number animating to a new value     | One breath that rises with the count       |

The material tells you the kind of event before you know which one: mallets for outcomes, glass for presence, air for motion, wood and keys for input.

## Which cue?

Pick by the job, not by the sound. Every row uses a cue that exists; emphasis and options do the rest.

| Moment | Cue |
| --- | --- |
| Primary button: save, send, submit | `tap` |
| Secondary or ghost button | `tap`, subtle |
| Destructive confirm: delete, remove | `close`, strong |
| Copy to clipboard | `success`, subtle |
| Like, star, bookmark | `toggle` |
| Undo / redo | `navigate`, subtle, `direction: "back"` / `"forward"` |
| Keystroke, delete, space, return | `type` (bindings set `key`) |
| Autocomplete accepted | `select` |
| Field fails validation | `error`, subtle |
| Menu, dropdown, or list option | `select` |
| Tab, segmented control, radio | `select` (bindings set `direction`) |
| Checkbox, switch | `toggle` (bindings set `direction`) |
| Slider or stepper step | `select`, subtle, `direction` |
| Menu or popover opens / closes | `open` / `close`, subtle |
| Dialog or drawer opens / closes | `open` / `close` |
| Accordion expands / collapses | `open` / `close`, subtle |
| Command palette | `open`, subtle, or nothing: it fires hundreds of times a day |
| Toast | the cue for what it reports, subtle |
| Route change | `navigate` |
| Back button | `navigate`, `direction: "back"` |
| Carousel, gallery, pagination | `navigate`, subtle, `direction` |
| Drag picked up / dropped / cancelled | `select` / `tap`, strong / `close`, subtle |
| Reorder a list item | `select`, `direction` |
| Saved, synced | `success`, subtle |
| Payment, publish, deploy confirmed | `success`, strong |
| Partial failure, deprecation, connection retrying | `warning` |
| Form rejected, permission denied | `error` |
| Upload, export, or build started | `loading` |
| Upload finished | `success` |
| Export ready to download | `ready` |
| Long job finished while the user was away | `ready`, strong |
| New message in an open conversation | `ready`, subtle |
| Reminder or timer due | `attention` |
| A number animates to a new value | `count`, `duration` matching the animation |
| A number counts down | `count`, `direction: "back"` |
| A live number that updates constantly: price feed, viewers | nothing |
| AI: prompt sent / generation started | `tap` / `loading`, subtle |
| AI: generation stopped | `close` |
| AI: reply finished streaming | `ready`, subtle |
| AI: tool call needs approval | `attention` |
| AI: agent task done (PR opened, file written) | `success` |
| AI: model, tool, or network failure | `error` |
| AI: suggestion accepted / rejected | `select` / `close`, subtle |
| AI: switch model or mode | `select` |
| One playful moment in a professional app, e.g. the AI model picker | the usual cue, `theme: "bubble"` |

Never play a cue per streamed token, per tool call inside an agent run, or on hover. Those fire in bursts and wear any sound out; play one cue when the run ends. An animated number gets one `count` when it starts moving, never one per digit.

## Typing

`data-cuelume-type` plays only on the field that carries it, and only for keys that edit text.

- Printable characters, Space, Backspace, and Delete play. Enter plays in a textarea or contenteditable, but not in a single-line input, where it submits.
- Password fields never play.
- Holding Backspace or Delete keeps playing as it deletes, and stops once there is nothing left to delete. Deleting a word or line with Option, Cmd, or Ctrl plays too.
- Modifier keys, arrows, shortcuts like Cmd+C, other held keys, and IME composition are ignored.
- Fast typing plays at most one sound every 40ms, and every keystroke lands at a slightly different pitch and weight, so a sentence never sounds like one key repeated.

## Selection

A native `<select data-cuelume-select>` plays when its value changes, not when it opens. Marked radio and checkbox inputs work the same way.

A custom option or menu item plays on `click`. A menu item built correctly fires `click` on Enter and Space too, so keyboard selection gets the same cue.

## Counting

Play `count` once when a number starts animating to a new value, and pass the animation's length so the roll lands with it:

```ts
play("count", { duration: 900 });                    // 0 → 1,284
play("count", { duration: 400, direction: "back" }); // 12 → 3
```

One breath rises with the number (and falls counting down), lasting as long as the roll. `duration` is in milliseconds, clamped to 300–2000; without it the roll takes 800 ms. Leave numbers that change more than about once a second, like a live price, silent.

## Context-aware

The same cue bends to how the interaction happened. Cuelume reads this from the event itself, so there is nothing to configure.

| Cue      | Listens to                        | What changes |
| -------- | --------------------------------- | ------------ |
| `type`   | Typing speed, which key           | Fast typing gets lighter and drops the key-return click. Space sounds bigger, Enter heaviest, Backspace and Delete lower. |
| `select` | Which way the selection moved     | A later option rises slightly and an earlier one falls. Custom options count among their marked siblings; a native select uses `selectedIndex`. |
| `tap`    | What activated it, rapid repeats  | Touch sounds softer and rounder than a mouse click, keyboard activation shorter, a pen crisper. Quick repeats get lighter. |
| `navigate` | `direction`, from `play()`       | `back` plays the whoosh falling instead of rising. |
| `toggle`   | Which way it switched              | Switching off plays its glides backwards: `default` and `mech` knock upward, `bubble`'s cork sinks. |
| `count`    | `duration` and `direction`, from `play()` | The roll stretches to the animation; `back` falls. |

Every change is small and bounded, so a cue always sounds like itself. When there's no context, as with a plain `play()` call, the cue plays as normal.

When you play a cue from code, pass the same context yourself:

```ts
play("navigate", { direction: "back" });
play("select", { direction: "forward" });
play("type", { key: "delete" });
play("tap", { input: "keyboard", emphasis: "subtle" });
```

A field a cue doesn't listen to is ignored, and an unknown value plays the cue as normal.

The one thing Cuelume can't infer is how much an action matters. Set that with emphasis, per call or per element:

```ts
play("success", { emphasis: "strong" }); // publish, pay, send
play("success", { emphasis: "subtle" }); // autosave, a small confirmation
```

```html
<button data-cuelume-tap data-cuelume-emphasis="subtle">Skip</button>
<div data-cuelume-emphasis="subtle">…a whole quiet toolbar…</div>
```

Each level is its own arrangement of the cue, so fourteen cues give you 42 distinct sounds to choose from. `subtle` strips the ornament: the glass tap loses its nail tick, typing becomes a quiet laptop keyboard, success turns into a felt mallet. `strong` adds a layer only it plays: a bigger glass, a deep mechanical bottom-out, an octave held under the second success note. Emphasis is not a volume knob: `volume` still scales loudness on its own, and the two combine. Invalid values play as `normal`.

Context comes from the current event and the timing of recent plays on the same page. Nothing is stored, sent, or kept across page loads, and Cuelume never guesses importance from class names, copy, or layout.

## Themes

Every cue comes in four finished materials. `default` is warm: glass, wood, air, and soft mallets. `mech` is dry and precise: a shutter click, a ratchet detent, a latch, struck metal. `bubble` is playful, and every cue is its own gesture: a knock, a drip, a cork, a gulp, a kalimba, a zip. `press` is one premium switch: every interaction is a crisp click over the knock of whatever it moves, and tap lets its body ring like a trackpad under a finger. Outcomes are not touched, so they do not click: success, error, warning, ready and attention are that warm note on its own, with a chord that says what happened, and `loading` is one soft, low note that swells and fades. Whatever the theme, every cue is one sound: it strikes once. All four have the same fourteen cues, context, and emphasis, and they're level-matched, so switching changes the material, not the volume.

```ts
import { play, setTheme } from "cuelume";

setTheme("mech");    // future plays use the mech material
setTheme("default");

play("select", { theme: "bubble" }); // one playful moment; the theme stays default
```

```html
<div data-cuelume-theme="bubble">
  <select data-cuelume-select>…</select>
</div>
```

`setTheme` applies to sounds played after the call. The `theme` option and `data-cuelume-theme` (on an element or any ancestor; the innermost wins) apply to one play and leave the active theme alone. Unknown names are ignored, and like volume, the choice isn't stored.

`default` and `mech` sit in a calm register for all-day use. Reach for `bubble` when a product, or one moment in it, should feel playful, and `press` when it should feel like touching hardware: clicky, deep and precise.

`press` is modelled on the trackpad and keycap sounds in DawoodUI's Artasaka preview.

## Sound settings

Cuelume starts enabled at full volume and never reads or writes storage. Your app owns the controls, labels, and persistence:

```ts
import { setEnabled, setVolume } from "cuelume";

setVolume(0.7);    // global multiplier, clamped to 0–1
setEnabled(false); // future play attempts become no-ops
setEnabled(true);  // enable playback again
```

If your app plays sound often, or the sound is decoration rather than information, give people a visible Sound toggle and pass its value to `setEnabled()`.

Cuelume does not follow `prefers-reduced-motion`. That setting is about motion. Someone who turns off animation may still want sound, and someone who wants silence may never touch it.

## API

```ts
import { play, bind, setEnabled, setVolume, setTheme, sounds, themes, type SoundName, type Emphasis, type ThemeName, type PlayOptions } from "cuelume";
```

- **`play(name?: SoundName, options?: PlayOptions)`**: play a cue immediately. Defaults to `"tap"`. Options apply to this play only:
  - `volume?: number`, clamped to `0–1`.
  - `emphasis?: "subtle" | "normal" | "strong"`.
  - `direction?: "forward" | "back"`: shapes `select`; `back` plays `navigate`, `toggle`, and `count` backwards.
  - `key?: "printable" | "space" | "delete" | "enter"`: shapes `type`.
  - `input?: "mouse" | "touch" | "pen" | "keyboard"`: shapes `tap`.
  - `theme?: ThemeName`: the material for this play only.
  - `duration?: number`: how long a `count` runs, in milliseconds, clamped to `300–2000`.
- **`bind(root?: ParentNode)`**: delegate all `data-cuelume-*` interactions under `root` (defaults to the whole document). Idempotent, and handles elements added later.
- **`setEnabled(enabled: boolean)`**: enable or disable future playback. Does not persist the preference or stop sounds already playing.
- **`setVolume(volume: number)`**: set the global volume for future playback, clamped to `0–1`. Non-finite values are ignored and preferences are not persisted.
- **`setTheme(theme: ThemeName)`**: switch the material of future playback. Unknown names are ignored; the choice isn't persisted.
- **`themes`**: the built-in theme names, `["default", "mech", "bubble", "press"]`.
- **`sounds`**: the fourteen cue names.
- **`SoundName`**: union type of the fourteen cue names.
- **`Emphasis`**: `"subtle" | "normal" | "strong"`.
- **`ThemeName`**: `"default" | "mech" | "bubble" | "press"`.

## Migrating from 0.2

0.3 replaces the seventeen-sound palette with the fourteen cues above. Until 1.0, the old names still play the cue that now does their job, and TypeScript marks them deprecated.

| 0.2 name                                         | Plays      |
| ------------------------------------------------ | ---------- |
| `chime`, `sparkle`                               | `success`  |
| `press`, `release`, `pulse`                      | `tap`      |
| `tick`, `whisper`, `scan`                        | `select`   |
| `bloom`                                          | `open`     |
| `droplet`                                        | `close`    |
| `page`, `arrival`                                | `navigate` |
| `toggle`, `success`, `error`, `loading`, `ready` | unchanged  |

`play()` with no name now plays `tap` instead of `chime`.

The old bindings also keep working until 1.0:

| 0.2 binding            | In 0.3                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `data-cuelume-hover`   | Plays `select` on hover. Hover is no longer a built-in binding; call `play()` from your own handler if you want it. |
| `data-cuelume-press`   | Plays `tap` on pointer down. Use `data-cuelume-tap`.                                    |
| `data-cuelume-release` | Plays `tap` on pointer up, unless the element also has `data-cuelume-press`, so an old press/release pair plays one `tap`. |

## Defaults that behave

- **One cue per action.** An event plays at most one cue, even with nested marked elements or several bound roots.
- **Keyboard included.** Click bindings follow native activation, so Enter and Space on a button play the same cue as a click.
- **Audible without clipping.** One shared boosted output stage keeps sounds clear, with native compression protecting overlapping cues.
- **Struck, not played back.** Tones are modelled on real bars: each overtone dies faster the higher it is, and a brief mallet contact starts the note. Every play of a frequent cue is one strike, a little harder or softer than the last, so a harder one is louder and brighter together and no two sound identical. Outcome cues play the same every time, so their meaning never blurs.
- **One faint room.** Every cue rings very faintly into one shared, short stereo room (about 22 dB down), which places it in the space around the listener rather than inside their head. `success` and `ready` ring into it a little more.
- **One lazy `AudioContext`.** Shared across all sounds, created on first use.
- **Autoplay-friendly.** Attempts to resume suspended audio without surfacing errors when a browser blocks it.
- **SSR-safe.** Importing on the server is a no-op.
- **Safe fallback.** Invalid runtime names and unavailable or blocked Web Audio make `play()` a silent no-op. An invalid attribute value plays that binding's default cue.
- **Dynamic, idempotent binding.** `bind()` never double-attaches listeners, and later DOM additions, removals, and clones work automatically.

## Frameworks

Cuelume works anywhere HTML does: plain pages, Astro, React, Vue. Call `bind()` once after the DOM is ready. Delegated listeners keep working when components or routes replace descendants.

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

## Claude Code

Cuelume also ships as a Claude Code plugin with two cues: `ready` when a turn of ten seconds or more finishes, and `attention` when a permission prompt is waiting on you.

```
/plugin marketplace add danielwh2/cuelume
/plugin install cuelume@cuelume
```

`/cuelume bubble` switches the theme and plays it, and `/cuelume off` silences it. See [claude-code/README.md](claude-code/README.md).

## License

MIT
