# Changelog

All notable changes to Cuelume are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `unlock()`: start audio from a user gesture, such as the click that turns
  sound on, instead of on the first cue. Resolves `true` once cues can sound
  and `false` while the browser still blocks audio. It also builds the output,
  room and noise up front, so the first cue doesn't pay for them.
- `bind()` returns a function that unbinds, for a component that unmounts or
  a module that hot reloads. A root stays bound until every caller that bound
  it has called theirs.

### Changed

- `setEnabled(false)` is heard at once: cues already ringing fade within a
  few milliseconds, where they used to play out.
- The output limiter is gone. No single cue ever reached it, and it held
  every cue back by 6 ms. The 3.2 dB it added is folded into the output, so
  cues are as loud as before, and a soft clip with no delay catches cues
  that stack.
- The room and the noise are the same on every page load and at every
  sample rate. They used to be drawn at random per page, which moved a
  ringing cue such as `ready` by a few dB from one load to the next and
  could lean it left or right.
- A layer's `decay` is now its ring time: the seconds it takes to fall
  60 dB. It used to be the time to reach a fixed floor, so a quiet layer
  rang up to three times longer than a loud one with the same number. Every
  recipe was converted to ring as it did; no cue moves by more than 0.3 dB.

### Fixed

- Cues asked for while the audio context is still starting (a slow output
  device, or iOS after backgrounding or an interruption) no longer all
  start at the same instant when it wakes and play as one much louder cue.
  Each play still asks the context to resume from its own gesture; only the
  latest one sounds, and a press and its release made while it wakes play
  as the whole cue. `setEnabled(false)` also drops a cue that is waiting.
- A short cue such as `tap` in the press theme is no longer silent on a
  fresh page in Chrome. Every play starts 10 ms ahead of the audio clock,
  and its nodes are let go when its sources have actually ended rather than
  on a wall-clock timer, which could disconnect a cue before a cold
  renderer had played it.
- A visit that starts with swipes on iOS, or whose first cue plays after an
  `await`, no longer stays silent until a tap happens to carry a cue. A cue
  the browser blocks is dropped, and audio starts on the next tap, click or
  key press, even one on a control with no cue. A cue left waiting on the
  context plays then only if it was asked for within the last second.
- The shared audio context no longer runs for as long as the page lives. It
  is suspended a second after the last cue has rung out, and at once when
  `setEnabled(false)` finds nothing sounding; the next cue resumes it. A
  running context kept the audio device open at its smallest buffer, which
  made other apps' audio crackle in Safari and WebKit views.
- Sound comes back after a screen lock or sleep in Safari without a reload.
  A context the browser has closed is replaced by a fresh one on the next
  cue, and so is one that reads `running` while its clock has stopped,
  which each play now checks for three quarters of a second later.

## [0.2.5] - 2026-10-13

### Added

- `press()` and `release()`: the two halves of `play()`, for a custom
  control that presses on `pointerdown` and lets go on `pointerup`.
- A recipe can carry a `release` and a `walk`. In `press`, tap, type,
  select, toggle and open let go with a lighter click, and quick taps and
  opens walk their note up three steps (tap goes C, E, A).
- Subpath export `cuelume/themes`: every theme's recipes as data, for
  tooling such as offline renderers and ports.
- A real-browser test (`test/browser.test.mjs`, `npm run test:browser`)
  that runs the built library in Chromium under its autoplay policy: no
  source starts before the first interaction, sources sound from the first
  click, and later cues reuse the one shared context. It needs
  `playwright-core`, a dev dependency; the library still has no runtime
  dependencies.
- `npm run typecheck` and `npm run check`, a CI workflow on Node 22 and 24,
  and `examples/` with vanilla and React starting points.

### Changed

- Bindings sound as the gesture goes down. A mouse plays the press on
  `pointerdown` and the release on the `click` that follows, touch and pen
  play both on lift, and a typed key lets go on `keyup`.
- `press` is re-voiced: tap clicks over a deep C that swells in and rings
  for about a second, and its outcomes are that note without the click.
- Themes are matched to `default` by how loud each cue sounds (K-weighted,
  within 1.5 dB), so master gains in `mech` and `bubble` moved.
- Everything under 40 Hz is cut before the limiter.
- Internal split, no behaviour change: layer types and builders live in
  `src/sounds/layers.ts`, the output bus and room in `src/audio/output.ts`,
  and rendering in `src/audio/render.ts`. `src/audio/engine.ts` keeps
  playback state and the public API, `src/sounds/recipes.ts` the default
  palette and legacy aliases.

## [0.2.4] - 2026-09-29

### Added

- `press` theme, struck-bar tones, and a shared room send on every cue.
  Each cue is one sound rather than a stack of effects.

[Unreleased]: https://github.com/danielwh2/cuelume/compare/v0.2.5...HEAD
[0.2.5]: https://github.com/danielwh2/cuelume/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/danielwh2/cuelume/releases/tag/v0.2.4
