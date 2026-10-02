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

## What it does on your machine

It plays the WAV files bundled in this folder and keeps your theme choice in Claude Code's plugin store. It reads nothing else, runs no other program and sends nothing over the network.

## Hooks

The plugin registers four hooks. None of them makes a decision for you. The first three pass their event on unchanged and return what Claude Code gave back; the last answers the plugin's own command.

| Hook | When it runs | What it does | What it decides |
| --- | --- | --- | --- |
| `classic.PermissionRequest` | A permission prompt is about to show | Plays `attention` | Nothing. It never allows, denies or answers the request; that decision stays with you |
| `turn.complete` | A turn ends | Plays `ready` if the turn ran ten seconds or more | Nothing. The answer is returned as it was |
| `session.start` | A session starts | Registers the `/cuelume` command | Nothing |
| `command.run` | You run `/cuelume` | Saves the theme you chose and plays it | Nothing |

## How the sounds are made

Cuelume synthesizes its cues live with Web Audio. A Claude Code mod can only play audio files, so each cue here is rendered once from Cuelume's own recipes to a 48 kHz WAV. The renderer skips Cuelume's output limiter, so a cue is close to what the library plays in a browser, not identical.
