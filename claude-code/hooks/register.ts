import type { EngineInterface, Register } from 'claude-code'

const THEMES = ['default', 'mech', 'bubble', 'press'] as const
const OFF = 'off'
const DEFAULT_THEME = 'default'
const THEME_KEY = 'theme'
// The cues are rendered near -21 dBFS, the library's own level.
const GAIN = 2
// A short reply is still on screen when it lands; only a turn worth walking away from rings.
const MIN_TURN_MS = 10_000

type Cue = 'ready' | 'attention'
type Choice = (typeof THEMES)[number] | typeof OFF

export const parseChoice = (text: string): Choice | undefined => {
  const word = text.trim().toLowerCase()

  return word === OFF || THEMES.some(theme => theme === word) ? (word as Choice) : undefined
}

async function chosen($: EngineInterface): Promise<Choice> {
  const stored = await $.store.get(THEME_KEY)

  return (typeof stored === 'string' && parseChoice(stored)) || DEFAULT_THEME
}

async function cue($: EngineInterface, name: Cue) {
  const theme = await chosen($)
  if (theme === OFF) return

  await $.audio
    .play({ asset: `sounds/${theme}/${name}.wav` }, { gain: GAIN })
    .catch((error: unknown) => $.ui.toast(`${$.plugin.name}: ${name} did not play: ${String(error)}`))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cuelume',
      description: 'Pick the sound theme for turn-end and permission cues, or turn them off',
      argumentHint: [...THEMES, OFF].join(' | '),
    })

    return next(e)
  })

  on('command.run', { command: 'cuelume' }, async ($, e) => {
    const choice = parseChoice(e.args)
    if (choice === undefined) {
      return { text: `cuelume: ${await chosen($)}. Options: ${[...THEMES, OFF].join(', ')}.` }
    }

    await $.store.set(THEME_KEY, choice)
    await cue($, 'ready')

    return { text: choice === OFF ? 'cuelume: off.' : `cuelume: ${choice}.` }
  })

  // The cue starts before next(e) and is awaited after it: a call left running once the hook returns never
  // plays, and this way the answer and the dialog do not wait on the sound. Each hook returns what next gave back.
  on('turn.complete', async ($, e, next) => {
    const isWorthRinging = e.agentId === undefined && e.reason === 'answer' && e.durationMs >= MIN_TURN_MS
    const playing = isWorthRinging ? cue($, 'ready') : undefined
    const answer = await next(e)
    await playing

    return answer
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    const playing = cue($, 'attention')
    const decision = await next(e)
    await playing

    return decision
  })
}
