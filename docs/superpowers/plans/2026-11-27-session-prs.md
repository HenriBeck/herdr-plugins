# Session PRs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pull requests panel also lists every PR/MR the Claude Code conversation in the focused pane created, with a repo label on every card and an accent on the current repo's cards.

**Architecture:** A new Claude Code plugin `herdr-claude-prs` watches tool calls for PR creates and keeps each conversation's PR URLs in `sessions/<session id>.json`, mirrored to `<HC_TERMINAL_ID>.json` for the pane. The panel reads the focused terminal's file, fetches each PR by URL through gh/glab, merges them with the branch lookup, and marks the ones whose repo matches a pane remote as current.

**Tech Stack:** Claude Code function-hook plugin (TypeScript, `claude plugin test`), Herdr mod (plain JS on gpui-kit, `node --test`), gh, glab.

**Spec:** `docs/superpowers/specs/2026-11-26-session-prs-design.md`

## Global Constraints

- Work on a branch `feat/session-prs` in the sibling worktree `../herdr-plugins-session-prs` (`.worktrees/` isn't gitignored here).
- Plugin files: `~/.cache/herdr-claude-prs/` (`$HERDR_CLAUDE_PRS_DIR` overrides), `sessions/<session id>.json` = `{ updated_at, prs: [{ url, created_at }] }`, `<HC_TERMINAL_ID>.json` = `{ updated_at, session_id, ended, prs }`; `updated_at` and `created_at` in epoch seconds; oldest first; at most the 20 newest kept.
- Outside Herdr (no `HC_TERMINAL_ID`) the plugin writes nothing.
- The plugin never blocks or fails a tool call: every failure goes to `$.ui.log` and the hook returns the tool's own result.
- Never display, log or store a remote URL; strip `user:token@` from any URL the plugin records or the panel shows (`scrub` in `prs.js`).
- The panel fetches nothing while hidden or under `checking()` (unchanged rules); at most the 10 newest session PRs are fetched.
- PR URL patterns: `https://<host>/<owner>/<repo>/pull/<n>` (GitHub) and `https://<host>/<path…>/-/merge_requests/<n>` (GitLab); `merge_requests/new`, a query, or more path after the number don't match.
- Files end with a newline. Never `--no-verify`. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Plugin API types: `/private/tmp/claude-502/bundled-skills/2.1.332/5d6a7d60f68a3cfe543db514424d881b/plugin-authoring/types/claude-code.d.ts` (grep it); `claude-context/claude-code-mod/` is the model to copy from (layout, `save`, `logFailure`, test helpers `disk`/`engine`/`setup`).

## Review Focus

1. Remotes in every shape (scp-like `git@host:group/sub/proj.git`, `ssh://git@host:2222/…`, `https://user:token@host/….git`, mixed case) must match a session PR's repo, so its card gets the accent — pinned in Task 3 (`remoteRepoKey`) and Task 3 (`mergePrs` current).
2. The same PR from the branch lookup and the session file, differing only in case or a trailing slash, shows once — pinned in Task 3 (`mergePrs` dedupe).
3. Create output without a PR URL (`gh pr create --web` prints a `/compare/` URL; an MR "new" link) records nothing — pinned in Task 1.
4. One session PR whose fetch fails (deleted repo, no access) becomes an error card and leaves the others intact — pinned in Task 4.
5. A session file with more than 10 URLs, non-PR URLs, or URLs with credentials: only the 10 newest valid PR URLs are fetched, credentials dropped — pinned in Task 3 (`parseSessionFile`).

---

### Task 1: Plugin `herdr-claude-prs` records created PRs

**Files:**
- Create: `pull-requests/claude-code-mod/.claude-plugin/plugin.json` (`name` `herdr-claude-prs`, `version` `0.1.0`, description "Saves the PRs and MRs each Claude Code conversation creates for the Herdr desktop app's pull requests panel")
- Create: `pull-requests/claude-code-mod/hooks/hooks.json` (`{ "modules": ["./register.ts"] }`)
- Create: `pull-requests/claude-code-mod/hooks/register.ts`
- Test: `pull-requests/claude-code-mod/hooks/register.test.ts`

**Interfaces:**
- Produces (exported from `register.ts` for tests, besides `register`):
  - `findPrUrls(text: string): string[]` — every PR URL in the text, userinfo dropped, in order, no duplicates.
  - `isCreateCommand(command: string): boolean` — `gh pr create` or `glab mr create` anywhere (whitespace between words may vary).
  - `isMcpCreate(e: { tool: string; merge_request_iid?: unknown }): boolean` — name ends in `__create_pull_request`, `__create_merge_request`, or `__save_merge_request` with `merge_request_iid` null/undefined.
- Produces (files): the two files of Global Constraints. Task 2 extends this module's lifecycle; keep one module-level state `{ id: string | null, prs: { url: string, created_at: number }[], terminalText: string | null }`.

- [ ] **Step 1: Write the failing tests**

Copy `disk`, `engine` and `setup` from `claude-context/claude-code-mod/hooks/register.test.ts`; DIR `/home/me/.cache/herdr-claude-prs`, terminal `t1r`, `session.id` answering a mutable `sid` (start `'sess-1'`); add an `fs.read` hook answering from `files` and throwing `new Error(\`read ${e.path} failed: ENOENT\`)` when missing; the bottom `tool.call` answers from a per-test `answer` (default `{ result: { stdout: '', stderr: '' } }`).

```ts
test('findPrUrls', () => {
  expect(findPrUrls('Creating…\nhttps://github.com/o/r/pull/7\n')).toEqual(['https://github.com/o/r/pull/7'])
  expect(findPrUrls('https://gitlab.example.com/g/sub/p/-/merge_requests/12.')).toEqual(['https://gitlab.example.com/g/sub/p/-/merge_requests/12'])
  expect(findPrUrls('https://u:tok@gitlab.com/g/p/-/merge_requests/3')).toEqual(['https://gitlab.com/g/p/-/merge_requests/3'])
  expect(findPrUrls('https://gitlab.com/g/p/-/merge_requests/new?x=1')).toEqual([])
  expect(findPrUrls('https://github.com/o/r/compare/main...feat?expand=1')).toEqual([])
  expect(findPrUrls('https://github.com/o/r/pull/7?w=1 https://github.com/o/r/pull/7/files')).toEqual([])
  expect(findPrUrls('a https://github.com/o/r/pull/7 b https://github.com/o/r/pull/7')).toEqual(['https://github.com/o/r/pull/7'])
})
test('isCreateCommand', () => {
  expect(isCreateCommand('git push -u origin HEAD && gh pr create --fill')).toBe(true)
  expect(isCreateCommand('glab  mr create -f')).toBe(true)
  expect(isCreateCommand('gh pr list --json url')).toBe(false)
})
test('records the URL gh pr create prints, in both files', async ($, on) => {
  // answer: stdout 'https://github.com/o/r/pull/7\n'
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  // terminal file: { updated_at: NOW_S, session_id: 'sess-1', ended: false, prs: [{ url, created_at: NOW_S }] }
  // sessions/sess-1.json: { updated_at: NOW_S, prs: [same] }
})
test('records from stderr too (glab mr create)')
test('ignores PR URLs from commands that are not creates (gh pr list)')
test('records nothing for a failed or denied create')        // answers { isError: true, result: … } and { deny: 'no' }
test('records nothing when the create prints no PR URL (gh pr create --web)')
test('MCP save_merge_request without merge_request_iid records the first PR URL in its result; with one it does not')
test('MCP create_pull_request records')                       // tool 'mcp__github__create_pull_request', result { html_url: '…/pull/9' }
test('a subagent call counts')                                // same Bash call with agentId: 'agent-1'
test('the same URL twice is kept once; only the 20 newest are kept')
test('the tool result passes through unchanged, even when a write fails') // fs.write throws: result equals the bottom's answer, ui.log called
test('does nothing outside Herdr')                             // no HC_TERMINAL_ID: zero writes
test('HERDR_CLAUDE_PRS_DIR overrides the folder')             // writes '/elsewhere/t9.json' and '/elsewhere/sessions/sess-1.json'
```

Each stub test above carries the assertions its name states, as `expect(...)` on the parsed files, `d.writes`, or the call's result.

- [ ] **Step 2: Run them to verify they fail**

Run: `claude plugin test pull-requests/claude-code-mod`
Expected: FAIL — `register.ts` doesn't exist / exports missing.

- [ ] **Step 3: Implement `register.ts`**

One `on('tool.call', …)` hook with no matcher: `const ran = await next(e)`; if `ran.deny === undefined && ran.isError !== true`, and either `e.tool === 'Bash' && isCreateCommand(e.command)` (URLs from `result.stdout + '\n' + result.stderr`) or `isMcpCreate(e)` (first URL of `typeof result === 'string' ? result : JSON.stringify(result)`), record them inside try/catch → `logFailure`; return `ran`. Recording: on first use load `sessions/<id>.json` for `$.session.id()` (missing/garbage → empty), append new URLs with `created_at` now, keep the last 20, write the session file, then the terminal file `{ updated_at, session_id, ended: false, prs }`; skip writes whose content (without `updated_at`) is unchanged. Header comment like claude-context's, naming both files.

- [ ] **Step 4: Run tests and validate**

Run: `claude plugin test pull-requests/claude-code-mod && claude plugin validate pull-requests/claude-code-mod`
Expected: all PASS; validate reports no errors.

- [ ] **Step 5: Commit**

```bash
git add pull-requests/claude-code-mod
git commit -m "feat: herdr-claude-prs records the PRs a Claude Code session creates"
```

### Task 2: Plugin follows the conversation (start, prompt, end) and is installable

**Files:**
- Modify: `pull-requests/claude-code-mod/hooks/register.ts`
- Test: `pull-requests/claude-code-mod/hooks/register.test.ts`
- Modify: `.claude-plugin/marketplace.json` (add `herdr-claude-prs`, source `./pull-requests/claude-code-mod`, same description as plugin.json)
- Modify: `pull-requests/README.md`, `README.md` (install lines `claude plugin install herdr-claude-prs@herdr-plugins` / `/plugin install herdr-claude-prs --marketplace HenriBeck/herdr-plugins`, next to claude-context's; a short "Session PRs" paragraph in pull-requests/README: what's recorded, the two files, that `/clear` starts empty and resume brings them back, and the known misses from the spec's "Calls made")

**Interfaces:**
- Consumes: Task 1's state and write helpers.
- Produces: `switchTo($, id: string)` (internal) — loads `sessions/<id>.json` and writes the terminal file `{ session_id: id, ended: false, prs }`.

- [ ] **Step 1: Write the failing tests**

```ts
test('session.start shows a resumed conversation's PRs')       // seed sessions/sess-1.json with one PR; start → terminal file prs equal it, ended false
test('session.start with no record writes an empty list')       // terminal file { session_id: 'sess-1', ended: false, prs: [] }
test('/clear empties the list; the next prompt starts the new conversation empty')
  // record a PR; end { reason: 'clear', sessionId: 'sess-1' } → terminal { session_id: null, ended: false, prs: [] };
  // sid = 'sess-2'; $.prompt.submit({ text: 'hi' }) → terminal { session_id: 'sess-2', prs: [] }; sessions/sess-1.json still has the PR
test('an in-process /resume shows the resumed PRs from the next prompt')
  // seed sessions/old.json; end { reason: 'resume' } → empty; sid = 'old'; prompt → prs from old.json
test('a create after /clear without a prompt goes to the new conversation') // end clear, sid = 'sess-2', record → sessions/sess-2.json
test('exit marks the terminal file ended and keeps the record')  // end 'prompt_input_exit' → ended true, sessions file unchanged
test('a prompt under the same id writes nothing')                // d.writes unchanged
```

The `engine` helper also echoes `prompt.submit` as core does (`({ text: e.text })`).

- [ ] **Step 2: Run them to verify they fail**

Run: `claude plugin test pull-requests/claude-code-mod`
Expected: the new tests FAIL; Task 1's still pass.

- [ ] **Step 3: Implement the lifecycle in `register.ts`**

`session.start`: after `next(e)`, `switchTo($, await $.session.id())`. `prompt.submit` and the record path: if `$.session.id()` differs from `state.id`, `switchTo` first. `session.end`: `reason` `clear` or `resume` → `state.id = null`, `prs = []`, terminal file `{ session_id: null, ended: false, prs: [] }`; otherwise terminal file with `ended: true`. All inside try/catch → `logFailure`, always returning `next(e)`'s result. Then marketplace and READMEs.

- [ ] **Step 4: Run tests and validate**

Run: `claude plugin test pull-requests/claude-code-mod && claude plugin validate pull-requests/claude-code-mod`
Expected: all PASS, no validate errors.

- [ ] **Step 5: Commit**

```bash
git add pull-requests/claude-code-mod .claude-plugin/marketplace.json README.md pull-requests/README.md
git commit -m "feat: session PRs follow the conversation through /clear and resume"
```

### Task 3: Panel logic for session PRs (pure)

**Files:**
- Create: `pull-requests/mod/session.js` (no imports except `./prs.js`)
- Test: `pull-requests/mod/session.test.mjs`

**Interfaces:**
- Consumes: `sortPrs`, `scrub` from `prs.js`.
- Produces:
  - `parsePrUrl(url: string): { provider: "github"|"gitlab", host, path, name, number, url } | null` — `host` lowercase, `path` as in the URL (`o/r`, `g/sub/p`), `name` its last segment, `url` without userinfo.
  - `remoteRepoKey(remote: string): string | null` — `"host/path"` lowercase, no `.git`, no userinfo or port.
  - `parseSessionFile(text: string | null): string[]` — PR URLs to fetch: `[]` for null, garbage, `ended: true`; otherwise the valid PR URLs (via `parsePrUrl`, cleaned), deduped, the 10 newest, newest first.
  - `mergePrs({ branch: Result, remotes: string[], session: Pr[], paneBranch: string|null }): { notice: string|null, prs: Pr[] }` — every Pr gains `repo: { host, path, name }` (from `parsePrUrl(pr.url)`, `{ host: "", path: "", name: "" }` when null) and `current`. `notice` is the branch result's `text` when it's a message.

- [ ] **Step 1: Write the failing tests**

```js
test("parsePrUrl", () => {
  assert.deepEqual(parsePrUrl("https://github.com/O/r/pull/7"), { provider: "github", host: "github.com", path: "O/r", name: "r", number: 7, url: "https://github.com/O/r/pull/7" });
  assert.equal(parsePrUrl("https://gitlab.example.com/g/sub/p/-/merge_requests/12").path, "g/sub/p");
  assert.equal(parsePrUrl("https://u:t@gitlab.com/g/p/-/merge_requests/3").url, "https://gitlab.com/g/p/-/merge_requests/3");
  for (const bad of ["https://gitlab.com/g/p/-/merge_requests/new", "https://github.com/o/r/pull/7?x", "https://github.com/o/r/pull/7/files", "https://github.com/o/pull/7", "http://github.com/o/r/pull/7", ""]) assert.equal(parsePrUrl(bad), null);
});
test("remoteRepoKey", () => {
  assert.equal(remoteRepoKey("git@gitlab.com:Group/Sub/Proj.git"), "gitlab.com/group/sub/proj");
  assert.equal(remoteRepoKey("ssh://git@gitlab.example.com:2222/g/p.git"), "gitlab.example.com/g/p");
  assert.equal(remoteRepoKey("https://user:tok@github.com/o/r.git"), "github.com/o/r");
  assert.equal(remoteRepoKey("https://github.com/o/r/"), "github.com/o/r");
  assert.equal(remoteRepoKey("/local/path"), null);
});
test("parseSessionFile", () => {
  const file = (prs, ended = false) => JSON.stringify({ session_id: "s", ended, prs: prs.map((url) => ({ url, created_at: 1 })) });
  const urls = Array.from({ length: 12 }, (_, i) => `https://github.com/o/r/pull/${i + 1}`);
  assert.deepEqual(parseSessionFile(file(urls)), urls.slice(2).reverse());
  assert.deepEqual(parseSessionFile(file(["https://x.com/a", "https://u:t@github.com/o/r/pull/1"])), ["https://github.com/o/r/pull/1"]);
  assert.deepEqual(parseSessionFile(file(urls, true)), []);
  for (const t of [null, "", "{", "[]", JSON.stringify({ prs: "x" })]) assert.deepEqual(parseSessionFile(t), []);
});
test("mergePrs: branch PRs are current; session PRs current when a remote matches, case-insensitively");
  // branch prs [github.com/o/r #7]; session [GitHub.com/O/R #8 (other branch), github.com/x/y #9]; remotes ["github.com/o/r"] → #7, #8 current, #9 not
test("mergePrs: a PR in both lists shows once (case and trailing slash differ)");
test("mergePrs: order — current first, the pane branch's first among them, then open before merged, newest first; other repos after");
test("mergePrs: a branch message becomes the notice above session PRs; no notice when the branch has PRs");
test("mergePrs: an error card (error set, state 'unknown') sorts after the open ones of its group");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test pull-requests/mod/`
Expected: FAIL — `session.js` missing.

- [ ] **Step 3: Implement `session.js`**

Within each group (current, other), sort by: pane-branch first (current group only), then `sortPrs`'s rule. Dedupe key: URL lowercase without a trailing slash; branch copy wins.

- [ ] **Step 4: Run tests**

Run: `node --test claude-usage/mod/ claude-context/mod/ pull-requests/mod/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add pull-requests/mod/session.js pull-requests/mod/session.test.mjs
git commit -m "feat: parse, match and merge session PRs for the pull requests panel"
```

### Task 4: Fetching session PRs and the pane's remotes

**Files:**
- Modify: `pull-requests/mod/load.js`, `pull-requests/mod/prs.js` (`summarizeGithub`)
- Test: `pull-requests/mod/load.test.mjs`, `pull-requests/mod/prs.test.mjs`

**Interfaces:**
- Consumes: `parsePrUrl`, `remoteRepoKey` (Task 3); `GH_FIELDS`, `optionalJson`-style helpers, `withGitlabDetails`, `summarizeGitlabList`, `firstLine`.
- Produces:
  - `summarizeGithub(prs, owner = null, { allForks = false } = {})` — `allForks` keeps cross-repository PRs.
  - `remoteRepos(where, exec): Promise<string[]>` — `git remote -v` in the pane's folder, each URL through `remoteRepoKey`, deduped; `[]` on any failure. Never rejects.
  - `loadSessionPrs(urls: string[], { cwd }, exec): Promise<Pr[]>` — one call set per URL, in parallel, `on: null`, never rejects. GitHub: `gh pr view <url> --json <GH_FIELDS>` → `summarizeGithub([obj], null, { allForks: true })[0]`. GitLab: `glab mr view <n> -R https://<host>/<path> -F json` → `summarizeGitlabList([view])[0]`, then `withGitlabDetails(pr, view, approvals)` with approvals from `glab api projects/<encodeURIComponent(path)>/merge_requests/<n>/approvals --hostname <host>` (optional). A failed or unreadable main call → `{ ref: "#n"|"!n", number, title: "", url, state: "unknown", source: "", target: "", updatedAt: "", pipeline: null, approvals: null, blocker: null, error: firstLine(stderr) || "<gh|glab> failed" }`; an exec rejection → error `"<gh|glab> isn't installed"`.

- [ ] **Step 1: Write the failing tests**

```js
test("summarizeGithub keeps forks with allForks"); // isCrossRepository: true, other owner → kept
test("remoteRepos: every remote as host/path, credentials gone", async () => {
  // "git remote -v": "origin\thttps://u:tok@github.com/me/r.git (fetch)\norigin\thttps://u:tok@github.com/me/r.git (push)\nupstream\tgit@github.com:O/R.git (fetch)\n"
  // → ["github.com/me/r", "github.com/o/r"]; cwd and on passed through
});
test("remoteRepos: git fails → []");
test("loadSessionPrs: GitHub by URL, from any folder", async () => {
  // table key `gh pr view https://github.com/o/r/pull/7 --json ${GH_FIELDS}` → ghPr; result[0].ref "#7", options.on null, options.cwd "/home/me"
});
test("loadSessionPrs: GitLab nested group, with -R and --hostname", async () => {
  // keys "glab mr view 12 -R https://gitlab.example.com/g/sub/p -F json" and
  // "glab api projects/g%2Fsub%2Fp/merge_requests/12/approvals --hostname gitlab.example.com"
  // → ref "!12", pipeline passed, approvals names ["Jane"]
});
test("loadSessionPrs: one failing PR becomes an error card, the other loads", async () => {
  // gh for #7 ok, #8 missing (code 1, stderr "GraphQL: Could not resolve to a PullRequest") → [#7 normal, #8 { state: "unknown", error: "GraphQL: Could not resolve to a PullRequest" }]
});
test("loadSessionPrs: error text loses credentials");          // stderr with https://u:tok@host → error without "u:tok@"
test("loadSessionPrs: gh missing → error \"gh isn't installed\"");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test pull-requests/mod/`
Expected: the new tests FAIL; existing ones pass.

- [ ] **Step 3: Implement**

Order of results follows `urls`. Reuse `TIMEOUT_MS`.

- [ ] **Step 4: Run tests**

Run: `node --test claude-usage/mod/ claude-context/mod/ pull-requests/mod/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add pull-requests/mod/load.js pull-requests/mod/prs.js pull-requests/mod/load.test.mjs pull-requests/mod/prs.test.mjs
git commit -m "feat: fetch session PRs by URL and list the pane's remotes"
```

### Task 5: The panel shows session PRs

**Files:**
- Modify: `pull-requests/mod/main.js`
- Modify: `pull-requests/install.sh` (copy `session.js` too)
- Modify: `pull-requests/README.md` (what the panel shows now: repo label, accent, notice line)

**Interfaces:**
- Consumes: `parseSessionFile`, `mergePrs` (Task 3); `loadPullRequests`, `remoteRepos`, `loadSessionPrs` (Task 4); `readTextFile`, `home`, `agents`, `focused` from `"herdr"`.
- Produces: cache entries `{ result: { branch: Result, remotes: string[], session: Pr[] }, at }`.

- [ ] **Step 1: Session file reading**

`this.sessionTexts` (terminal id → text|null). A second timer `cx.timer.every(2000, …)` (not under `checking()`) reads `${home()}/.cache/herdr-claude-prs/<id>.json` for the focused terminal when `shown()`, the id has no `/`, and `agents().some((a) => a.address === id)`; on change store it and `cx.notify()`. `sessionUrls()` = `parseSessionFile(text)` for that terminal, else `[]` (also `[]` for a remote pane, `where.on !== null`).

- [ ] **Step 2: Cache key and refresh**

`keyFor(where)` gains the URL list: `JSON.stringify([on, root ?? cwd, branch, urls])` — a new URL is a new key, so `refreshDue` fetches at once. `refresh` runs `loadPullRequests`, `remoteRepos` and `loadSessionPrs(urls, { cwd: home() }, exec)` in parallel and stores the three.

- [ ] **Step 3: Render**

`const { notice, prs } = mergePrs({ branch: result.branch, remotes: result.remotes, session: result.session, paneBranch: where.branch })`. No PRs → `notice` alone as today's body text. PRs → a dim `notice` line (when set) above the cards. Card: repo name as a small dim `flex_none` label at the end of the first line; current cards get a 3 px `t.accent` strip on the left edge (a child of an `h_flex` around the content, since a gpui border has one colour); other cards the same 3 px kept invisible (or 3 px more left padding if gpui-kit has no transparent colour) so text lines up. An error card shows ref, repo label and the error line in `t.dim` instead of the state, pipeline and approvals lines. Card ids use the URL, not the ref, now that refs from different repos can collide.

- [ ] **Step 4: Check it in Herdr**

Run: `node --test claude-usage/mod/ claude-context/mod/ pull-requests/mod/ && ./pull-requests/install.sh`
Expected: tests PASS; `herdr-app check` reports no errors.

Then write a terminal file by hand for the focused Claude pane (`~/.cache/herdr-claude-prs/<HC_TERMINAL_ID>.json` with one PR of this repo's remote and one of another repo, e.g. a GitHub PR from `gh pr list -R cli/cli --limit 1 --json url`), open the panel (`herdr-app do layout.select --stack panel-body --child pull-requests`), and `herdr-app shot`: the two cards show their repo names, only the current-repo card has the accent, the branch message shows above them. Restore the file afterwards (delete it if it didn't exist).

- [ ] **Step 5: Commit**

```bash
git add pull-requests/mod/main.js pull-requests/install.sh pull-requests/README.md
git commit -m "feat: pull requests panel lists the session's PRs with repo labels"
```
