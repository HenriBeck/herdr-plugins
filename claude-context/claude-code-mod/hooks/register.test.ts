import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionContextUsage, SessionCost } from 'claude-code'

const DIR = '/home/me/.cache/herdr-claude-context'
const FILE = `${DIR}/t1r.json`
const NOW_MS = Date.parse('2026-11-26T12:00:00Z')
const NOW_S = NOW_MS / 1000

// An in-memory disk under the plugin: `files` is what's on it, `writes` counts writes.
function disk(on: On, files: Record<string, string>) {
  const state = { writes: 0 }
  on('fs.write', (_$, e) => {
    files[e.path] = e.text
    state.writes++
    return { value: undefined }
  })
  return state
}

// The engine beneath the plugin: echoes measure/end/start as core does, answers model/id/usage.
function engine(on: On, model = 'Opus 5.5') {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.model', () => ({ value: model }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: NOW_MS, context: { window: 200000 }, rateLimits: [] } }))
  on('ui.log', () => ({ value: undefined }))
}

function setup(on: On, env: Record<string, string> = { HOME: '/home/me', HC_TERMINAL_ID: 't1r' }) {
  const files: Record<string, string> = {}
  mock.env(on, env)
  mock.clock(on, { now: NOW_MS })
  engine(on)
  return { files, d: disk(on, files) }
}

const measure = (context: SessionContextUsage, cost?: SessionCost, changed: ('context' | 'rateLimits' | 'cost')[] = ['context']) => ({
  context,
  rateLimits: [],
  cost,
  changed,
})

const saved = (files: Record<string, string>) => JSON.parse(files[FILE] ?? 'null')

test('writes the session figures to a file named after the Herdr terminal', async ($, on) => {
  const { files } = setup(on)
  await $.session.measure(measure({ tokens: 84000, window: 200000, percent: 42 }, { usd: 1.234 }))
  expect(saved(files)).toEqual({
    updated_at: NOW_S,
    session_id: 'sess-1',
    model: 'Opus 5.5',
    context: { tokens: 84000, window: 200000, percent: 42 },
    cost_usd: 1.234,
    ended: false,
  })
})

test('session.start writes the model and window before the first turn', async ($, on) => {
  const { files } = setup(on)
  await $.session.start({ cwd: '/w', surface: 'terminal' } as never)
  expect(saved(files).model).toBe('Opus 5.5')
  expect(saved(files).context).toEqual({ tokens: null, window: 200000, percent: null })
})

test('does nothing outside Herdr', async ($, on) => {
  const { d } = setup(on, { HOME: '/home/me' })
  await $.session.measure(measure({ tokens: 1, window: 200000, percent: 0 }))
  expect(d.writes).toBe(0)
})

test('HERDR_CLAUDE_CONTEXT_DIR overrides the folder', async ($, on) => {
  const { files } = setup(on, { HOME: '/home/me', HC_TERMINAL_ID: 't9', HERDR_CLAUDE_CONTEXT_DIR: '/elsewhere' })
  await $.session.measure(measure({ tokens: 1, window: 200000, percent: 0 }))
  expect(Object.keys(files)).toEqual(['/elsewhere/t9.json'])
})

test('unchanged figures are not written again', async ($, on) => {
  const { d } = setup(on)
  await $.session.measure(measure({ tokens: 5, window: 200000, percent: 0 }))
  await $.session.measure(measure({ tokens: 5, window: 200000, percent: 0 }, undefined, ['rateLimits']))
  expect(d.writes).toBe(1)
})

test('/clear empties the figures; any other end marks the file ended', async ($, on) => {
  const { files } = setup(on)
  await $.session.measure(measure({ tokens: 84000, window: 200000, percent: 42 }, { usd: 2 }))
  await $.session.end({ reason: 'clear', sessionId: 'sess-1' } as never)
  expect(saved(files).context).toEqual({ tokens: null, window: 200000, percent: null })
  expect(saved(files).cost_usd).toBe(null)
  expect(saved(files).ended).toBe(false)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sess-1' } as never)
  expect(saved(files).ended).toBe(true)
})

test('a failed write never breaks the session', async ($, on) => {
  mock.env(on, { HOME: '/home/me', HC_TERMINAL_ID: 't1r' })
  mock.clock(on, { now: NOW_MS })
  engine(on)
  on('fs.write', () => { throw new Error('EACCES: permission denied') })
  const r = await $.session.measure(measure({ tokens: 1, window: 200000, percent: 0 }))
  expect(r.changed).toEqual(['context'])
})
