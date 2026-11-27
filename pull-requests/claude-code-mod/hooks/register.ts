// herdr-claude-prs: saves the pull requests (GitHub) and merge requests
// (GitLab) this Claude Code conversation creates, so the Herdr desktop app's
// pull-requests panel can list them for the focused pane.
//
// Two kinds of file in ~/.cache/herdr-claude-prs/ ($HERDR_CLAUDE_PRS_DIR overrides it):
//   sessions/<session id>.json  { updated_at, prs: [{ url, created_at }] }
//     the conversation's record, oldest first, the 20 newest kept;
//   <HC_TERMINAL_ID>.json       { updated_at, session_id, ended, prs }
//     what the panel reads: the list of the conversation now in that terminal.
// Times are epoch seconds. Outside Herdr (no HC_TERMINAL_ID) nothing is written.

import type { EngineInterface as Engine, Register } from 'claude-code'

type Entry = { url: string; created_at: number }
type View = { session_id: string | null; ended: boolean; prs: Entry[] }

// The conversation whose list is in the terminal file, its PRs, and the
// terminal file's last content (without updated_at), so unchanged views aren't written.
type State = { id: string | null; prs: Entry[]; terminalText: string | null }

const MAX_PRS = 20

const SEG = '[A-Za-z0-9_.~-]+'
// A GitHub PR (host/owner/repo/pull/n) or a GitLab MR (host/path…/-/merge_requests/n),
// ending where the URL ends: not before a query, a fragment or more path.
const PR_URL = new RegExp(
  `https://(?:[^\\s/@"'<>]+@)?[A-Za-z0-9.-]+(?::\\d+)?/(?:${SEG}/${SEG}/pull|(?:${SEG}/)+-/merge_requests)/\\d+(?![\\w/?#&=%-])`,
  'g',
)

/** Every PR URL in the text, credentials dropped, in order, each once. */
export function findPrUrls(text: string): string[] {
  const found = (text.match(PR_URL) ?? []).map(url => url.replace(/^https:\/\/[^/]*@/, 'https://'))
  return [...new Set(found)]
}

/** Whether a shell command creates a PR or MR. */
export function isCreateCommand(command: string): boolean {
  return /\bgh\s+pr\s+create\b|\bglab\s+mr\s+create\b/.test(command)
}

/** Whether an MCP tool call creates a PR or MR (save_merge_request with an iid updates one). */
export function isMcpCreate(e: { tool: string; merge_request_iid?: unknown }): boolean {
  if (!e.tool.startsWith('mcp__')) return false
  if (e.tool.endsWith('__create_pull_request') || e.tool.endsWith('__create_merge_request')) return true
  return e.tool.endsWith('__save_merge_request') && e.merge_request_iid == null
}

async function folder($: Engine): Promise<string> {
  return (await $.env.get('HERDR_CLAUDE_PRS_DIR')) ?? `${await $.env.get('HOME')}/.cache/herdr-claude-prs`
}

const nowSeconds = async ($: Engine) => Math.floor((await $.clock.now()) / 1000)

// A conversation's saved PRs; a missing or unreadable record is an empty list.
async function loadRecord($: Engine, dir: string, id: string): Promise<Entry[]> {
  try {
    const saved = JSON.parse(String(await $.fs.read(`${dir}/sessions/${id}.json`)))
    if (!Array.isArray(saved?.prs)) return []
    return saved.prs.filter(
      (p: unknown): p is Entry =>
        typeof (p as Entry)?.url === 'string' && typeof (p as Entry)?.created_at === 'number',
    )
  } catch {
    return []
  }
}

async function writeTerminal($: Engine, state: State, view: View) {
  const terminal = await $.env.get('HC_TERMINAL_ID')
  if (!terminal) return
  const text = JSON.stringify(view)
  if (text === state.terminalText) return
  const updated_at = await nowSeconds($)
  await $.fs.write(`${await folder($)}/${terminal}.json`, `${JSON.stringify({ updated_at, ...view })}\n`)
  state.terminalText = text
}

// Shows the conversation `id` in the terminal file, with its saved PRs.
async function switchTo($: Engine, state: State, id: string) {
  state.id = id
  state.prs = await loadRecord($, await folder($), id)
  await writeTerminal($, state, { session_id: id, ended: false, prs: state.prs })
}

async function record($: Engine, state: State, urls: string[]) {
  if (!urls.length || !(await $.env.get('HC_TERMINAL_ID'))) return
  const id = await $.session.id()
  if (state.id !== id) await switchTo($, state, id)
  const known = new Set(state.prs.map(p => p.url))
  const added = urls.filter(url => !known.has(url))
  if (!added.length) return
  const now = await nowSeconds($)
  state.prs = [...state.prs, ...added.map(url => ({ url, created_at: now }))].slice(-MAX_PRS)
  await $.fs.write(`${await folder($)}/sessions/${id}.json`, `${JSON.stringify({ updated_at: now, prs: state.prs })}\n`)
  await writeTerminal($, state, { session_id: id, ended: false, prs: state.prs })
}

// Saving is best effort: a failure is logged and the session goes on.
function logFailure($: Engine, err: unknown) {
  $.ui.log(`${$.plugin.name}: could not save PRs: ${err instanceof Error ? err.message : String(err)}`)
}

export const register: Register = on => {
  const state: State = { id: null, prs: [], terminalText: null }

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      let urls: string[] = []
      if (e.tool === 'Bash' && isCreateCommand(e.command)) {
        const out = ran.result as { stdout?: unknown; stderr?: unknown } | undefined
        urls = findPrUrls(`${String(out?.stdout ?? '')}\n${String(out?.stderr ?? '')}`)
      } else if (isMcpCreate(e as { tool: string; merge_request_iid?: unknown })) {
        const result: unknown = ran.result
        urls = findPrUrls(typeof result === 'string' ? result : JSON.stringify(result) ?? '').slice(0, 1)
      }
      await record($, state, urls)
    } catch (err) {
      logFailure($, err)
    }
    return ran
  })
}
