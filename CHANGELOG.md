# Changelog

All notable changes to Cuelume are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/danielwh2/cuelume/compare/v0.2.4...HEAD
[0.2.4]: https://github.com/danielwh2/cuelume/releases/tag/v0.2.4
