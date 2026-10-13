# Examples

Two starting points, one per way people adopt Cuelume. Both use only the
public API documented in the main README.

## Vanilla

`vanilla/index.html` wires `data-cuelume-*` attributes with one `bind()`
and plays outcome cues from code. Build first, then serve the repo root
with any static server and open the page:

```sh
npm run build
npx serve .          # or any static file server
# open /examples/vanilla/
```

A static server is required: browsers will not load ES modules from
`file://`. The first click also unlocks audio — browsers block sound
before the first interaction, and Cuelume stays silent until then.

## React

`react/App.tsx` is a drop-in component for an existing React app (it is
not a standalone project and adds no dependencies of its own):

```sh
npm install cuelume
```

Call `bind()` once in an effect, mark elements with `data-cuelume-*`,
and call `play()` for outcomes your app already knows about. It works the
same in Vue, Astro, and plain templates: `bind()` after the DOM is ready,
and again is unnecessary — it is idempotent and delegated.
