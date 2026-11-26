import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

const FILE = '/home/me/.cache/herdr-claude-usage.json'
const NOW_MS = Date.parse('2026-11-26T12:00:00Z')
const NOW_S = NOW_MS / 1000
const RESET_5H = '2026-11-26T15:00:00.000Z'
const RESET_7D = '2026-12-01T20:00:00.000Z'
const s = (iso: string) => Date.parse(iso) / 1000

// An in-memory disk under the plugin: `files` is what's on it, `writes` counts writes.
function disk(on: On, files: Record<string, string>) {
  const state = { writes: 0 }
  on('fs.read', (_$, e) => {
    if (!(e.path in files)) throw new Error(`ENOENT: ${e.path}`)
    return { value: files[e.path] }
  })
  on('fs.write', (_$, e) => {
    files[e.path] = e.text
    state.writes++
    return { value: undefined }
  })
  return state
}

// The engine beneath the plugin echoes `changed`, as core does.
const engine = (on: On) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.log', () => ({ value: undefined }))
}

function setup(on: On, files: Record<string, string> = {}) {
  mock.env(on, { HOME: '/home/me' })
  mock.clock(on, { now: NOW_MS })
  engine(on)
  return disk(on, files)
}

const limits = (used5: number, used7: number, r5 = RESET_5H, r7 = RESET_7D): SessionRateLimit[] => [
  { kind: 'five_hour', percentUsed: used5, resetsAt: r5 },
  { kind: 'seven_day', percentUsed: used7, resetsAt: r7 },
]

const measure = (rateLimits: SessionRateLimit[], changed: ('context' | 'rateLimits' | 'cost')[] = ['rateLimits']) => ({
  context: { window: 200000, used: null, percent: null, apiUsage: null } as never,
  rateLimits,
  changed,
})

const saved = (files: Record<string, string>) => JSON.parse(files[FILE])

test('writes both windows in the file format the Herdr card reads', async ($, on) => {
  const files: Record<string, string> = {}
  setup(on, files)
  await $.session.measure(measure(limits(12.5, 30)))
  expect(saved(files)).toEqual({
    updated_at: NOW_S,
    rate_limits: {
      five_hour: { used_percentage: 12.5, resets_at: s(RESET_5H) },
      seven_day: { used_percentage: 30, resets_at: s(RESET_7D) },
    },
  })
})

test('HERDR_CLAUDE_USAGE_FILE overrides the path', async ($, on) => {
  const files: Record<string, string> = {}
  mock.env(on, { HOME: '/home/me', HERDR_CLAUDE_USAGE_FILE: '/elsewhere/u.json' })
  mock.clock(on, { now: NOW_MS })
  engine(on)
  disk(on, files)
  await $.session.measure(measure(limits(1, 2)))
  expect(Object.keys(files)).toEqual(['/elsewhere/u.json'])
})

test('ignores spend_limit and other kinds', async ($, on) => {
  const files: Record<string, string> = {}
  setup(on, files)
  await $.session.measure(measure([...limits(1, 2), { kind: 'spend_limit', percentUsed: 50 }]))
  expect(Object.keys(saved(files).rate_limits).sort()).toEqual(['five_hour', 'seven_day'])
})

test('a newer reset from the engine beats an older epoch-second tap file', async ($, on) => {
  const old = { updated_at: NOW_S - 600, rate_limits: { five_hour: { used_percentage: 90, resets_at: s(RESET_5H) - 5 * 3600 }, seven_day: { used_percentage: 30, resets_at: s(RESET_7D) } } }
  const files = { [FILE]: JSON.stringify(old) }
  setup(on, files)
  await $.session.measure(measure(limits(3, 30)))
  expect(saved(files).rate_limits.five_hour).toEqual({ used_percentage: 3, resets_at: s(RESET_5H) })
})

test('same reset: the higher usage wins; an older snapshot loses', async ($, on) => {
  const old = { updated_at: NOW_S - 600, rate_limits: { five_hour: { used_percentage: 40, resets_at: s(RESET_5H) }, seven_day: { used_percentage: 30, resets_at: s(RESET_7D) } } }
  const files = { [FILE]: JSON.stringify(old) }
  setup(on, files)
  // five_hour: same reset, lower usage (another session's stale snapshot) → keep 40.
  // seven_day: same reset, higher usage → 35.
  await $.session.measure(measure(limits(20, 35)))
  expect(saved(files).rate_limits).toEqual({
    five_hour: { used_percentage: 40, resets_at: s(RESET_5H) },
    seven_day: { used_percentage: 35, resets_at: s(RESET_7D) },
  })
  // An older seven_day window (before its reset) loses outright.
  await $.session.measure(measure(limits(40, 99, RESET_5H, '2026-11-24T20:00:00.000Z')))
  expect(saved(files).rate_limits.seven_day.used_percentage).toBe(35)
})

test('a window the engine no longer reports keeps its saved value', async ($, on) => {
  const old = { updated_at: NOW_S - 600, rate_limits: { five_hour: { used_percentage: 5, resets_at: s(RESET_5H) }, seven_day: { used_percentage: 30, resets_at: s(RESET_7D) } } }
  const files = { [FILE]: JSON.stringify(old) }
  setup(on, files)
  await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 6, resetsAt: RESET_5H }]))
  expect(saved(files).rate_limits.seven_day).toEqual({ used_percentage: 30, resets_at: s(RESET_7D) })
  expect(saved(files).rate_limits.five_hour.used_percentage).toBe(6)
})

test('a corrupt file is replaced', async ($, on) => {
  const files = { [FILE]: '{not json' }
  setup(on, files)
  await $.session.measure(measure(limits(1, 2)))
  expect(saved(files).rate_limits.five_hour.used_percentage).toBe(1)
})

test('unchanged figures do not rewrite the file', async ($, on) => {
  const old = { updated_at: NOW_S - 600, rate_limits: { five_hour: { used_percentage: 5, resets_at: s(RESET_5H) }, seven_day: { used_percentage: 30, resets_at: s(RESET_7D) } } }
  const files = { [FILE]: JSON.stringify(old) }
  const d = setup(on, files)
  await $.session.measure(measure(limits(5, 30)))
  expect(d.writes).toBe(0)
})

test('nothing is written when rate limits did not change or are empty', async ($, on) => {
  const files: Record<string, string> = {}
  const d = setup(on, files)
  await $.session.measure(measure(limits(1, 2), ['context']))
  await $.session.measure(measure([]))
  expect(d.writes).toBe(0)
})

test('a failed write never breaks the session', async ($, on) => {
  mock.env(on, { HOME: '/home/me' })
  mock.clock(on, { now: NOW_MS })
  engine(on)
  on('fs.read', () => { throw new Error('ENOENT') })
  on('fs.write', () => { throw new Error('EACCES: permission denied') })
  const r = await $.session.measure(measure(limits(1, 2)))
  expect(r.changed).toEqual(['rateLimits'])
})
