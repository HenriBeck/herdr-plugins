import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { findPrUrls, isCreateCommand, isMcpCreate } from './register'

const DIR = '/home/me/.cache/herdr-claude-prs'
const TERMINAL = `${DIR}/t1r.json`
const session = (id: string) => `${DIR}/sessions/${id}.json`
const NOW_MS = Date.parse('2026-11-27T12:00:00Z')
const NOW_S = NOW_MS / 1000
const PR7 = 'https://github.com/o/r/pull/7'

type Answer = Record<string, unknown>

// An in-memory disk under the plugin: `files` is what's on it, `writes` counts writes.
function disk(on: On, files: Record<string, string>) {
  const state = { writes: 0 }
  on('fs.write', (_$, e) => {
    files[e.path] = e.text
    state.writes++
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    if (files[e.path] === undefined) throw new Error(`read ${e.path} failed: ENOENT`)
    return { value: files[e.path] }
  })
  return state
}

// The engine beneath the plugin. `world.sid` is what $.session.id() answers,
// `world.answer` what the tool call resolves to, `world.logs` what ui.log got.
function engine(on: On, world: { sid: string; answer: Answer; logs: string[] }) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('session.id', () => ({ value: world.sid }))
  on('ui.log', (_$, e) => {
    world.logs.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('tool.call', () => world.answer as never)
}

function setup(on: On, env: Record<string, string> = { HOME: '/home/me', HC_TERMINAL_ID: 't1r' }) {
  const files: Record<string, string> = {}
  const world = { sid: 'sess-1', answer: { result: { stdout: '', stderr: '' } } as Answer, logs: [] as string[] }
  mock.env(on, env)
  mock.clock(on, { now: NOW_MS })
  const d = disk(on, files)
  engine(on, world)
  return { files, d, world }
}

const read = (files: Record<string, string>, path: string) => JSON.parse(files[path] ?? 'null')
const urls = (files: Record<string, string>, path: string) => (read(files, path)?.prs ?? []).map((p: { url: string }) => p.url)
const bash = (stdout: string, stderr = '') => ({ result: { stdout, stderr } })

test('findPrUrls', () => {
  expect(findPrUrls('Creating…\nhttps://github.com/o/r/pull/7\n')).toEqual([PR7])
  expect(findPrUrls('https://gitlab.example.com/g/sub/p/-/merge_requests/12.')).toEqual([
    'https://gitlab.example.com/g/sub/p/-/merge_requests/12',
  ])
  expect(findPrUrls('https://u:tok@gitlab.com/g/p/-/merge_requests/3')).toEqual(['https://gitlab.com/g/p/-/merge_requests/3'])
  expect(findPrUrls('https://gitlab.com/g/p/-/merge_requests/new?x=1')).toEqual([])
  expect(findPrUrls('https://github.com/o/r/compare/main...feat?expand=1')).toEqual([])
  expect(findPrUrls('https://github.com/o/r/pull/7?w=1 https://github.com/o/r/pull/7/files')).toEqual([])
  expect(findPrUrls(`a ${PR7} b ${PR7}`)).toEqual([PR7])
  expect(findPrUrls('{"web_url":"https://gitlab.com/g/p/-/merge_requests/4","x":1}')).toEqual([
    'https://gitlab.com/g/p/-/merge_requests/4',
  ])
})

test('isCreateCommand', () => {
  expect(isCreateCommand('git push -u origin HEAD && gh pr create --fill')).toBe(true)
  expect(isCreateCommand('glab  mr create -f')).toBe(true)
  expect(isCreateCommand('gh pr list --json url')).toBe(false)
  expect(isCreateCommand('glab mr view 3')).toBe(false)
})

test('isMcpCreate', () => {
  expect(isMcpCreate({ tool: 'mcp__github__create_pull_request' })).toBe(true)
  expect(isMcpCreate({ tool: 'mcp__gitlab__create_merge_request' })).toBe(true)
  expect(isMcpCreate({ tool: 'mcp__claude_ai_Gitlab__save_merge_request' })).toBe(true)
  expect(isMcpCreate({ tool: 'mcp__claude_ai_Gitlab__save_merge_request', merge_request_iid: 12 })).toBe(false)
  expect(isMcpCreate({ tool: 'mcp__claude_ai_Gitlab__get_merge_request' })).toBe(false)
  expect(isMcpCreate({ tool: 'Bash' })).toBe(false)
})

test('records the URL gh pr create prints, in both files', async ($, on) => {
  const { files, world } = setup(on)
  world.answer = bash(`${PR7}\n`)
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  const prs = [{ url: PR7, created_at: NOW_S }]
  expect(read(files, TERMINAL)).toEqual({ updated_at: NOW_S, session_id: 'sess-1', ended: false, prs })
  expect(read(files, session('sess-1'))).toEqual({ updated_at: NOW_S, prs })
})

test('records from stderr too (glab mr create)', async ($, on) => {
  const { files, world } = setup(on)
  world.answer = bash('', 'Creating merge request for feat into main\nhttps://gitlab.com/g/p/-/merge_requests/5\n')
  await $.tool.call({ tool: 'Bash', command: 'glab mr create -f -y' })
  expect(urls(files, TERMINAL)).toEqual(['https://gitlab.com/g/p/-/merge_requests/5'])
})

test('ignores PR URLs from commands that are not creates', async ($, on) => {
  const { d, world } = setup(on)
  world.answer = bash(`${PR7}\n`)
  await $.tool.call({ tool: 'Bash', command: 'gh pr list --json url' })
  expect(d.writes).toBe(0)
})

test('records nothing for a failed or denied create', async ($, on) => {
  const { d, world } = setup(on)
  world.answer = { isError: true, result: { stdout: `${PR7}\n`, stderr: 'merge failed' } }
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill && gh pr merge --auto' })
  world.answer = { deny: 'no' }
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  expect(d.writes).toBe(0)
})

test('records nothing when the create prints no PR URL (gh pr create --web)', async ($, on) => {
  const { d, world } = setup(on)
  world.answer = bash('Opening https://github.com/o/r/compare/main...feat?expand=1 in your browser.\n')
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --web' })
  expect(d.writes).toBe(0)
})

test('MCP save_merge_request records without merge_request_iid, not with one', async ($, on) => {
  const { files, d, world } = setup(on)
  world.answer = { result: { iid: 4, web_url: 'https://gitlab.com/g/p/-/merge_requests/4' } }
  await $.tool.call({ tool: 'mcp__claude_ai_Gitlab__save_merge_request', merge_request_iid: 4, title: 'x' } as never)
  expect(d.writes).toBe(0)
  await $.tool.call({ tool: 'mcp__claude_ai_Gitlab__save_merge_request', title: 'x' } as never)
  expect(urls(files, TERMINAL)).toEqual(['https://gitlab.com/g/p/-/merge_requests/4'])
})

test('MCP create_pull_request records from a text result', async ($, on) => {
  const { files, world } = setup(on)
  world.answer = { result: 'Created https://github.com/o/r/pull/9 (see also https://github.com/o/r/pull/1)' }
  await $.tool.call({ tool: 'mcp__github__create_pull_request', title: 'x' } as never)
  expect(urls(files, TERMINAL)).toEqual(['https://github.com/o/r/pull/9'])
})

test('a subagent call counts', async ($, on) => {
  const { files, world } = setup(on)
  world.answer = bash(`${PR7}\n`)
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill', agentId: 'agent-1' } as never)
  expect(urls(files, TERMINAL)).toEqual([PR7])
})

test('the same URL twice is kept once; only the 20 newest are kept', async ($, on) => {
  const { files, world } = setup(on)
  for (let n = 1; n <= 22; n++) {
    world.answer = bash(`https://github.com/o/r/pull/${n}\n`)
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  }
  world.answer = bash(`https://github.com/o/r/pull/22\n`)
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  const kept = Array.from({ length: 20 }, (_, i) => `https://github.com/o/r/pull/${i + 3}`)
  expect(urls(files, TERMINAL)).toEqual(kept)
  expect(urls(files, session('sess-1'))).toEqual(kept)
})

test('the tool result passes through unchanged, even when a write fails', async ($, on) => {
  const world = { sid: 'sess-1', answer: bash(`${PR7}\n`) as Answer, logs: [] as string[] }
  mock.env(on, { HOME: '/home/me', HC_TERMINAL_ID: 't1r' })
  mock.clock(on, { now: NOW_MS })
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.write', () => {
    throw new Error('EACCES: permission denied')
  })
  engine(on, world)
  const r = await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  expect(r.result).toEqual({ stdout: `${PR7}\n`, stderr: '' })
})

test('does nothing outside Herdr', async ($, on) => {
  const { d, world } = setup(on, { HOME: '/home/me' })
  world.answer = bash(`${PR7}\n`)
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  expect(d.writes).toBe(0)
})

test('HERDR_CLAUDE_PRS_DIR overrides the folder', async ($, on) => {
  const { files, world } = setup(on, { HOME: '/home/me', HC_TERMINAL_ID: 't9', HERDR_CLAUDE_PRS_DIR: '/elsewhere' })
  world.answer = bash(`${PR7}\n`)
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  expect(Object.keys(files).sort()).toEqual(['/elsewhere/sessions/sess-1.json', '/elsewhere/t9.json'])
})
