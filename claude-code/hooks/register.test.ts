import { expect, mock, test } from 'claude-code/testing'

import { parseChoice } from './register'

const turn = { answer: 'done', isAborted: false, turnId: 't', reason: 'answer' } as const

test('reads a theme, off, and nothing else', () => {
  expect(parseChoice(' Mech ')).toBe('mech')
  expect(parseChoice('off')).toBe('off')
  expect(parseChoice('')).toBe(undefined)
  expect(parseChoice('loud')).toBe(undefined)
})

test('rings in the chosen theme, and not at all when off', async ($, on) => {
  const played: string[] = []
  mock.store(on)
  on('audio.play', (_, e) => {
    played.push(`${e.clip.asset} x${e.gain}`)
    return null
  })
  on('command.register', (_, e) => ({ command: e.name }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.SessionStart', () => ({}))

  await $.turn.complete({ ...turn, durationMs: 2_000 })
  await $.turn.complete({ ...turn, durationMs: 60_000, agentId: 'sub' })
  expect(played).toEqual([])

  await $.turn.complete({ ...turn, durationMs: 60_000 })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  expect(played).toEqual(['sounds/default/ready.wav x2', 'sounds/default/attention.wav x2'])

  const switched = await $.command.run({ command: 'cuelume', args: 'bubble' })
  expect(switched.text).toBe('cuelume: bubble.')
  await $.turn.complete({ ...turn, durationMs: 60_000 })
  expect(played.slice(2)).toEqual(['sounds/bubble/ready.wav x2', 'sounds/bubble/ready.wav x2'])

  await $.command.run({ command: 'cuelume', args: 'off' })
  await $.turn.complete({ ...turn, durationMs: 60_000 })
  expect(played.length).toBe(4)
})
