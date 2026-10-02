# Cuelume for Claude Code

Two [Cuelume](../README.md) sounds for Claude Code, so you can look away while it works.

| When | Cue |
| --- | --- |
| A turn of ten seconds or more ends with an answer | `ready` |
| A permission prompt is waiting on you | `attention` |

Short replies, interrupted turns and subagent turns stay silent.

## Install

```
/plugin marketplace add danielwh2/cuelume
/plugin install cuelume@cuelume
```

It needs a Claude Code version with mods, and macOS: Claude Code plays plugin audio through `afplay`, so other platforms stay silent.

## Themes

```
/cuelume            show the current theme
/cuelume bubble     switch to default, mech, bubble or press, and hear it
/cuelume off        no sounds
```

Your choice is kept across sessions.

`press` is modelled on the trackpad and keycap sounds in DawoodUI's Artasaka preview.

## How the sounds are made

Cuelume synthesizes its cues live with Web Audio. A Claude Code mod can only play audio files, so each cue here is rendered once from Cuelume's own recipes to a 48 kHz WAV. The renderer skips Cuelume's output limiter, so a cue is close to what the library plays in a browser, not identical.
