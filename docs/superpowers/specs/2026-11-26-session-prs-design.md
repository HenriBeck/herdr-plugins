# Session PRs in the pull requests panel — design

Size: project (a new Claude Code plugin and changes to the `pull-requests` panel).

## Intent

The pull requests panel shows the PRs of the focused pane's branch. A Claude
Code session often opens PRs in other branches or other repos too. Henri wants
the panel to also list every PR the session in the focused pane created, and to
make it obvious which PRs belong to the project the pane is in and which are
elsewhere.

## Goals

- When the focused pane runs Claude Code, the panel also lists the PRs (GitHub)
  and MRs (GitLab) that session created, with the same status report as today
  (state, pipeline, approvals, blocker).
- One list (Henri's pick, "B"). Every card shows its repo's name. Cards of the
  current repo (the repo of the focused pane's folder) carry an accent; others
  don't.
- Order: current repo first (its current branch's PRs at the top, then its
  other branches), then other repos; open and draft before merged and closed,
  newest first within each.
- A PR found both by the branch lookup and in the session's list shows once.
- A newly created PR appears within a couple of seconds while the panel is open.

## Non-goals (for now)

- PRs the session pushed to without creating them (Henri: "extend it to 2
  later"); PRs it only looked at.
- Session PRs for panes on another machine: like claude-context, only files on
  this computer are read. Remote panes keep the branch lookup.
- Sections or grouping headers (approach "A", not picked).

## Anti-goals

- Recording PRs the session didn't create, such as any URL in `gh pr list` output.
- Slowing a Claude Code session: the plugin's work never blocks or fails a tool
  call; failures are logged and the call's result passes through untouched.
- Fetching while the panel is hidden (unchanged from the panel's rules).
- Showing remote URLs or credentials (unchanged).

## Approaches

| Approach | Trade-off | Picked |
|---|---|---|
| **1. New Claude Code plugin `herdr-claude-prs` records created PR URLs per Herdr terminal; the panel fetches their status by URL** | One more plugin to install; exact, cheap, and "pushed to" later is a small change in the same hook | ✅ Henri's pick |
| 2. Same, inside `herdr-claude-context` | One plugin fewer, but one plugin with two unrelated jobs; can't have one without the other | ✗ |
| 3. No plugin: the panel searches the session transcript for PR URLs | Transcripts outgrow Herdr's 1 MiB read; undocumented format; re-parsed every refresh | ✗ |

## How it's built

### Repo layout

- `pull-requests/claude-code-mod/` — the Claude Code plugin `herdr-claude-prs`:
  `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`,
  `hooks/register.test.ts` (`claude plugin test`), like
  `claude-context/claude-code-mod/`. Added to `.claude-plugin/marketplace.json`.
- `pull-requests/mod/` — the panel, extended.
- READMEs (plugin's and root) updated, including install lines.

### Plugin `herdr-claude-prs`

**Files.** The PRs follow the conversation (Henri's pick): they belong to a
session id, so `claude --resume`, which keeps the id, brings them back, and
`/clear`, which starts a new id, starts an empty list. Two kinds of file in
`~/.cache/herdr-claude-prs/` (`$HERDR_CLAUDE_PRS_DIR` overrides the folder):
- `sessions/<session id>.json`: the record, `{ updated_at, prs: [{ url, created_at }] }`,
  oldest first, at most the 20 newest kept.
- `<HC_TERMINAL_ID>.json`: what the panel reads,
  `{ updated_at, session_id, ended, prs }`, a copy of the list of the
  conversation now in that terminal.

Outside Herdr (no `HC_TERMINAL_ID`) it does nothing, not even the record.

**What counts as created.**
- **Bash:** the command contains `gh pr create` or `glab mr create` (anywhere,
  so `git push && gh pr create …` counts), the call wasn't denied and has no
  `isError`. Every PR URL in its stdout and stderr is recorded.
- **MCP:** a tool whose name ends in `__create_pull_request`,
  `__create_merge_request` or `__save_merge_request`, and for
  `save_merge_request` only when the input has no `merge_request_iid` (with
  one it's an update). Not denied, no `isError`. The first PR URL in its
  result (stringified) is recorded.
- Subagents' calls count: they're the session's work.

**PR URL patterns.** `https://<host>/<owner>/<repo>/pull/<n>` (GitHub) and
`https://<host>/<path…>/-/merge_requests/<n>` (GitLab); a URL ending in
`merge_requests/new` or with a query doesn't match. Userinfo is dropped. A URL
already in the list isn't added twice.

**Session lifecycle.** `session.start` fires for a new process (including
`claude --resume`) and a plugin reload, but not for `/clear` or an in-process
`/resume`; those only end the old session, and the process goes on under
another id. So:
- **Switching** to a session id loads `sessions/<id>.json` (missing or garbage
  means an empty list) and writes the terminal file with that id,
  `ended: false` and that list.
- `session.start` switches to `$.session.id()`.
- `prompt.submit` and every recorded create check `$.session.id()` against the
  id last written and switch when it differs. This is how `/clear` and an
  in-process `/resume` reach the new conversation.
- `session.end` with `reason` `clear` or `resume` writes the terminal file
  with `session_id: null`, `ended: false` and no PRs, so the panel drops the
  old conversation's list at once; the next prompt fills in the new one's.
  Any other reason writes `ended: true` (the record stays for a later resume).
- **Recording** a PR adds it to `sessions/<id>.json` and copies the list to the
  terminal file.
- Writes skip when nothing changed. Every failure is logged with `$.ui.log`
  and the hook still returns the tool's own result.

### Panel `pull-requests`

**Session file.** While the panel is shown, the focused terminal's file is read
every 2 s when that terminal is a live agent on this computer (`agents()`
holds its address; ids with a `/` are remote and skipped, as in
claude-context). An `ended` file, a missing file or garbage means no session
PRs. A change in its URL list triggers a refresh.

**Fetching a session PR by URL** (from any folder):
- GitHub: `gh pr view <url> --json <the fields the branch lookup uses>`.
- GitLab: `glab mr view <n> -R https://<host>/<path> -F json` and
  `glab api projects/<url-encoded path>/merge_requests/<n>/approvals --hostname <host>`.
- Same parsing as today (`summarizeGithub` / `summarizeGitlabList` +
  `withGitlabDetails`), one call set per PR, in parallel. A PR whose fetch
  fails still shows as a card with its `ref` and repo and the error's first
  line (scrubbed) instead of the status lines.
- At most the 10 newest session PRs are fetched; the file never holds more
  than 20.

**Merging.** Branch-lookup PRs and session PRs are joined by URL (session copy
dropped when the branch lookup has it). Each `Pr` gains
`repo: { host, path, name }` (`name` = last path segment) and
`current: boolean`: every PR the branch lookup returned is current, and a
session PR is current when its host and path equal those of *any* of the
pane's remotes, compared lowercase without `.git` (so in a fork setup, where
`origin` is the fork and PRs live upstream, the upstream remote matches).
Session PRs skip the fork filter: the session created them, so they're ours. Sort: current first; within current, PRs whose `source` is the pane's
branch first; then by the existing open-first/newest rule; other repos after,
by the same rule.

**When the branch lookup has no PRs.** Its message ("No merge requests for
main", "Not a git repository", …) shows as one dim line above the session
PRs, or alone when there are none.

**Look.** Each card gets the repo name as a small dim label on its first line.
Current-repo cards get a 3 px accent (`t.accent`) left border; others a
transparent one so text lines up. Cache and refresh rules are unchanged; the
cache key gains the session's URL list.

```
 PRs · feat/effort                     ⟳
 No merge requests for main             ← only when the branch has none
┌──────────────────────────────────────┐
┃ !1423  Add bottom-bar effort         │  herdr-plugins
┃ open · feat/effort → main            │
┃ ● pipeline passed · 1 of 2 approvals │
├──────────────────────────────────────┤
│ !31  Chart: MCP service              │  storefront-hosting-chart
│ open · poc/mcp → main                │
│ ● pipeline failed                    │
└──────────────────────────────────────┘
```

### Tests

- Plugin (`claude plugin test`): records from `gh pr create` and
  `glab mr create` output; ignores `gh pr list` output with URLs; ignores a
  failed create; MCP `save_merge_request` without iid records, with iid
  doesn't; dedupes; keeps 20; start loads a seeded `sessions/<id>.json`
  (resume); a `clear` end empties the terminal file and the next prompt under
  a new id starts an empty list; a `resume` end followed by a prompt under a
  seeded id shows that id's list; a normal end marks ended and keeps the
  record; nothing outside Herdr.
- Panel (`node --test`): PR URL parsing (GitHub, GitLab nested groups,
  self-hosted); remote path parsing; `current` matching; merge and dedupe;
  sort order; session fetch per provider with a fake exec (including a failing
  PR); session file parsing (missing, ended, garbage).

## Calls made while writing this up (Claude's, not Henri's)

- **"Current" in a fork setup:** branch-lookup PRs are always current; session
  PRs match against all remotes, not only `origin`.
- **Session PRs skip the fork filter** (`summarizeGithub` with the PR's own
  owner, or no filter).
- **Creates whose URL isn't in the tool result are missed for now:** a
  backgrounded Bash command (empty stdout when the hook sees it), and a chain
  that fails after the create (`gh pr create … && gh pr merge --auto` failing
  gives `isError`). Error text isn't scanned, so `gh`'s "a pull request …
  already exists: <url>" isn't recorded either. "Pushed to" (later) will cover
  most of these.
- **After an in-process `/resume`** the resumed PRs show from the next prompt
  on, not the moment the resume happens: no event fires in between.
- **Session records are never pruned** for now: each is under 2 KB.
- **MCP results:** the builder confirms the GitLab MCP create result carries
  the MR's `web_url`; if a tool's result has no PR URL, nothing is recorded.

## Left to the builder

- Exact label placement and spacing on the card.
- Whether the session file is read by the same timer as the refresh or its own.
