# Pull requests panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "PRs" side panel in Herdr, opened from a button next to Files and Changes, listing the GitHub PRs / GitLab MRs of the focused pane's branch with pipeline, approvals, state and blockers.

**Architecture:** Two Herdr mods. `pull-requests` is the panel: pure parsing in `prs.js`, all CLI calls in `load.js` (exec injected, so both are tested with `node --test`), the view in `main.js`. `tabs-prs` is Herdr's shipped `tabs` mod (0.1.18) with a third panel button. The `main-usage` layout points its tab bar at `tabs-prs` and gets a `pull-requests` block in `panel-body`.

**Tech Stack:** Herdr mods (plain ES modules on `gpui-kit` / `gpui-base` / `herdr`), `git`, `gh` 2.105, `glab` 1.131, `node --test`, `herdr-app check`.

**Spec:** docs/superpowers/specs/2026-11-26-pull-requests-panel-design.md

## Global Constraints

- The panel never displays, logs or stores a remote URL; any CLI text shown first goes through `scrub()` (removes `user:token@` userinfo).
- No fetching while the panel is hidden or `window().visible === false`; auto refresh every 60 s, plus on focus `(machine, cwd, branch)` change, panel shown, and the refresh button.
- `exec` always gets an args array (never a shell string); `cwd` and `on` come from the focused pane.
- GitHub: one `gh pr list --head <branch> --state all --limit 20 --json …` call. GitLab: `glab mr list --source-branch <branch> --all -F json --per-page 20`, then details (`glab mr view <iid> -F json`, `glab api projects/<project_id>/merge_requests/<iid>/approvals`) for at most 5 MRs after sorting, in parallel.
- Provider: host `github.com` → github; host containing `gitlab` → gitlab; else unsupported.
- Sorting: open and draft first, then merged and closed; newest `updatedAt` first within each group.
- Colours from the theme: pipeline passed → `t.accent`, running/manual → `t.muted`, failed → `t.ansi1`, canceled/none → `t.dim`; merged/closed cards dimmed.
- Every new file ends with a newline. Repo layout per plugin: `<plugin>/mod/`, `<plugin>/install.sh`, `<plugin>/README.md`.
- `pull-requests/mod/prs.js` and `load.js` import nothing (so `node --test` loads them).

## Review Focus

- Focus moves to another pane while a fetch is running: the late result must not show under the new pane (keyed cache; Task 3 manual check).
- A remote or CLI error carrying `https://user:token@host` must never reach the screen (Task 1 `scrub` tests, Task 2 error-path test).
- A branch name with slashes or shell characters (`feat/a b;c`) reaches `gh`/`glab` verbatim as one argument (Task 2 test).
- One GitLab MR whose `view` or `approvals` call fails still lists, with `pipeline`/`approvals` null, while the others show in full (Task 2 test).
- `gh`/`glab` missing on the machine (`exec` rejects) gives "gh isn't installed" rather than a blank panel (Task 2 test).

---

### Task 1: `prs.js` — parsing and summarising

**Files:**
- Create: `pull-requests/mod/prs.js`
- Test: `pull-requests/mod/prs.test.mjs` (header comment `// Run: node --test pull-requests/mod/`)

**Interfaces:**
- Produces (all exported from `prs.js`):
  - `parseRemoteHost(url: string): string | null` — lowercase host from `git@host:path`, `ssh://[user@]host[:port]/path`, `http(s)://[userinfo@]host[:port]/path`; null otherwise.
  - `providerFor(host: string | null): "github" | "gitlab" | null`
  - `scrub(text: string): string` — removes `userinfo@` after `://`.
  - `firstLine(text: string): string` — first non-empty line, trimmed, scrubbed, cut to 200 chars.
  - `summarizeGithub(list: object[]): Pr[]` — input is `gh pr list --json` output; drops `isCrossRepository === true`.
  - `summarizeGitlabList(list: object[]): Pr[]` — `glab mr list -F json` output; `pipeline` and `approvals` null; keeps `projectId`.
  - `withGitlabDetails(pr: Pr, view: object | null, approvals: object | null): Pr`
  - `sortPrs(prs: Pr[]): Pr[]` (new array)
  - `pipelineLabel(status: PipelineStatus): string`, `approvalsLabel(a: Approvals): string`, `ageLabel(ms: number): string`
  - Types (JSDoc in `prs.js`):
    ```
    Pr = { ref: string /* "#12" | "!12" */, number: number, title: string, url: string,
           state: "open" | "draft" | "merged" | "closed", source: string, target: string,
           updatedAt: string, projectId?: number,
           pipeline: { status: PipelineStatus, url: string | null } | null,
           approvals: Approvals | null, blocker: "conflicts" | "changes requested" | null }
    PipelineStatus = "passed" | "failed" | "running" | "manual" | "canceled" | "none"
    Approvals = { names: string[], required: number | null, left: number | null,
                  decision: "approved" | "changes requested" | "review required" | null }
    ```

- [ ] **Step 1: Write the failing tests**

```js
test("parseRemoteHost", () => {
  assert.equal(parseRemoteHost("git@github.com:HenriBeck/herdr-plugins.git"), "github.com");
  assert.equal(parseRemoteHost("ssh://git@gitlab.example.com:2222/a/b.git"), "gitlab.example.com");
  assert.equal(parseRemoteHost("https://x-token-auth:SECRET@bitbucket.org/a/b.git"), "bitbucket.org");
  assert.equal(parseRemoteHost("https://GitLab.com/a/b"), "gitlab.com");
  assert.equal(parseRemoteHost("/some/local/path"), null);
  assert.equal(parseRemoteHost(""), null);
});

test("providerFor", () => {
  assert.equal(providerFor("github.com"), "github");
  assert.equal(providerFor("gitlab.com"), "gitlab");
  assert.equal(providerFor("gitlab.example.com"), "gitlab");
  assert.equal(providerFor("bitbucket.org"), null);
  assert.equal(providerFor(null), null);
});

test("scrub and firstLine never leak userinfo", () => {
  assert.equal(scrub("fatal: https://u:tok@host/x.git"), "fatal: https://host/x.git");
  assert.equal(firstLine("\n  error: https://u:tok@h/r  \nmore"), "error: https://h/r");
  assert.equal(firstLine("x".repeat(300)).length, 200);
});

test("summarizeGithub: states, checks, reviews, blockers, forks", () => {
  const base = { number: 7, title: "T", url: "https://github.com/o/r/pull/7", state: "OPEN", isDraft: false,
    headRefName: "feat/a", baseRefName: "main", updatedAt: "2026-11-26T10:00:00Z", isCrossRepository: false,
    reviewDecision: "", latestReviews: [], statusCheckRollup: [], mergeable: "MERGEABLE" };
  const [pr] = summarizeGithub([base]);
  assert.deepEqual(pr, { ref: "#7", number: 7, title: "T", url: base.url, state: "open", source: "feat/a", target: "main",
    updatedAt: base.updatedAt, pipeline: { status: "none", url: `${base.url}/checks` },
    approvals: { names: [], required: null, left: null, decision: null }, blocker: null });
  const status = (rollup) => summarizeGithub([{ ...base, statusCheckRollup: rollup }])[0].pipeline.status;
  assert.equal(status([{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }]), "passed");
  assert.equal(status([{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }, { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" }]), "running");
  assert.equal(status([{ __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" }, { __typename: "StatusContext", state: "FAILURE" }]), "failed");
  assert.equal(status([{ __typename: "StatusContext", state: "PENDING" }]), "running");
  assert.equal(status([{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" }]), "passed");
  assert.equal(summarizeGithub([{ ...base, isDraft: true }])[0].state, "draft");
  assert.equal(summarizeGithub([{ ...base, state: "MERGED" }])[0].state, "merged");
  assert.equal(summarizeGithub([{ ...base, state: "CLOSED" }])[0].state, "closed");
  const reviewed = summarizeGithub([{ ...base, reviewDecision: "APPROVED",
    latestReviews: [{ author: { login: "jane" }, state: "APPROVED" }, { author: { login: "bob" }, state: "COMMENTED" }] }])[0];
  assert.deepEqual(reviewed.approvals, { names: ["jane"], required: null, left: null, decision: "approved" });
  assert.equal(summarizeGithub([{ ...base, mergeable: "CONFLICTING" }])[0].blocker, "conflicts");
  assert.equal(summarizeGithub([{ ...base, reviewDecision: "CHANGES_REQUESTED" }])[0].blocker, "changes requested");
  assert.deepEqual(summarizeGithub([{ ...base, isCrossRepository: true }]), []);
});

test("summarizeGitlabList and withGitlabDetails", () => {
  const mr = { iid: 12, project_id: 99, title: "M", web_url: "https://gitlab.com/g/p/-/merge_requests/12", state: "opened",
    draft: false, source_branch: "feat/a", target_branch: "main", updated_at: "2026-11-26T10:00:00Z",
    has_conflicts: false, detailed_merge_status: "mergeable" };
  const [pr] = summarizeGitlabList([mr]);
  assert.equal(pr.ref, "!12"); assert.equal(pr.projectId, 99); assert.equal(pr.state, "open");
  assert.equal(pr.pipeline, null); assert.equal(pr.approvals, null); assert.equal(pr.blocker, null);
  assert.equal(summarizeGitlabList([{ ...mr, draft: true }])[0].state, "draft");
  assert.equal(summarizeGitlabList([{ ...mr, state: "merged" }])[0].state, "merged");
  assert.equal(summarizeGitlabList([{ ...mr, state: "locked" }])[0].state, "closed");
  assert.equal(summarizeGitlabList([{ ...mr, has_conflicts: true }])[0].blocker, "conflicts");
  assert.equal(summarizeGitlabList([{ ...mr, detailed_merge_status: "requested_changes" }])[0].blocker, "changes requested");
  const full = withGitlabDetails(pr, { head_pipeline: { status: "success", web_url: "https://gitlab.com/p/1" } },
    { approved_by: [{ user: { name: "Jane Doe" } }], approvals_required: 2, approvals_left: 1 });
  assert.deepEqual(full.pipeline, { status: "passed", url: "https://gitlab.com/p/1" });
  assert.deepEqual(full.approvals, { names: ["Jane Doe"], required: 2, left: 1, decision: null });
  const map = (s) => withGitlabDetails(pr, { head_pipeline: { status: s, web_url: null } }, null).pipeline.status;
  assert.equal(map("failed"), "failed"); assert.equal(map("running"), "running"); assert.equal(map("pending"), "running");
  assert.equal(map("created"), "running"); assert.equal(map("manual"), "manual"); assert.equal(map("canceled"), "canceled");
  assert.equal(map("skipped"), "canceled");
  assert.deepEqual(withGitlabDetails(pr, { head_pipeline: null }, null).pipeline, { status: "none", url: null });
  assert.equal(withGitlabDetails(pr, null, null).pipeline, null);
});

test("sortPrs: open and draft first, then newest", () => {
  const p = (ref, state, updatedAt) => ({ ref, state, updatedAt });
  const sorted = sortPrs([p("a", "merged", "2026-11-26"), p("b", "open", "2026-11-01"), p("c", "draft", "2026-11-20"), p("d", "closed", "2026-11-25")]);
  assert.deepEqual(sorted.map((x) => x.ref), ["c", "b", "a", "d"]);
});

test("labels", () => {
  assert.equal(pipelineLabel("passed"), "pipeline passed");
  assert.equal(pipelineLabel("none"), "no pipeline");
  assert.equal(approvalsLabel({ names: ["Jane"], required: 2, left: 1, decision: null }), "1 of 2 approvals · Jane");
  assert.equal(approvalsLabel({ names: [], required: 0, left: 0, decision: null }), "no approvals required");
  assert.equal(approvalsLabel({ names: ["jane"], required: null, left: null, decision: "approved" }), "approved · jane");
  assert.equal(approvalsLabel({ names: [], required: null, left: null, decision: "review required" }), "review required");
  assert.equal(approvalsLabel({ names: [], required: null, left: null, decision: null }), "no reviews");
  assert.equal(ageLabel(5_000), "just now");
  assert.equal(ageLabel(90_000), "1 min ago");
  assert.equal(ageLabel(2 * 3600_000), "2 h ago");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test pull-requests/mod/`
Expected: FAIL, `prs.js` not found.

- [ ] **Step 3: Implement `prs.js`** with the exports above. Header comment like `claude-context/mod/context.js` ("Pure logic … no imports, so `node --test` can load it"). Non-string/garbage fields fall back to `""` / null rather than throwing. GitHub `ref` is `#n`, GitLab `!n`. GitHub failure conclusions: `FAILURE`, `TIMED_OUT`, `CANCELLED`, `ACTION_REQUIRED`, `STARTUP_FAILURE`, StatusContext `FAILURE`/`ERROR`; running: CheckRun `status !== "COMPLETED"`, StatusContext `PENDING`/`EXPECTED`. GitLab running set: `running, pending, created, preparing, waiting_for_resource, scheduled`.

- [ ] **Step 4: Run the tests**

Run: `node --test pull-requests/mod/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add pull-requests/mod/prs.js pull-requests/mod/prs.test.mjs
git commit -m "feat: parse GitHub PRs and GitLab MRs for the pull requests panel"
```

---

### Task 2: `load.js` — from a pane's folder to a result

**Files:**
- Create: `pull-requests/mod/load.js`
- Test: `pull-requests/mod/load.test.mjs`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `loadPullRequests(where: { cwd: string, on: string | null }, exec: Exec): Promise<Result>`, never rejects.
  - `Exec = (command: string, args: string[], options: { cwd: string, on: string | null, timeout: number }) => Promise<{ code: number, stdout: string, stderr: string }>` (Herdr's `exec`; rejects when the program can't start).
  - `Result = { kind: "prs", provider: "github" | "gitlab", branch: string, prs: Pr[] } | { kind: "message", branch: string | null, text: string }`
- Order of calls (all with `{ cwd, on, timeout: 20000 }`):
  1. `git rev-parse --show-toplevel` → non-zero: "Not a git repository".
  2. `git symbolic-ref --short -q HEAD` → non-zero or empty: "Not on a branch".
  3. `git remote get-url origin`; if non-zero, `git remote` and `git remote get-url <first>`; none: "This repo has no remote".
  4. `providerFor(parseRemoteHost(url))` null → "This repo isn't on GitHub or GitLab".
  5. GitHub: `gh pr list --head <branch> --state all --limit 20 --json number,title,state,isDraft,headRefName,baseRefName,url,updatedAt,isCrossRepository,reviewDecision,latestReviews,statusCheckRollup,mergeable`.
     GitLab: `glab mr list --source-branch <branch> --all -F json --per-page 20`, sort, then for the first 5: `glab mr view <iid> -F json` and `glab api projects/<projectId>/merge_requests/<iid>/approvals`, all in parallel; a failed or unparsable detail call gives null for that part only.
  6. Empty list: "No pull requests for <branch>" (GitHub) / "No merge requests for <branch>" (GitLab).
- Errors: an `exec` rejection for `gh`/`glab` → "gh isn't installed" / "glab isn't installed" (for `git`: "git isn't available"); a non-zero exit → `firstLine(stderr)` or "gh failed" / "glab failed"; unparsable JSON → "Couldn't read gh's answer" / "Couldn't read glab's answer". Each message keeps the branch once known.

- [ ] **Step 1: Write the failing tests** with a fake exec built from a table keyed by `"<command> <args joined by space>"`, recording every call:

```js
function fakeExec(table) {
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, options });
    const hit = table[`${command} ${args.join(" ")}`];
    if (hit === undefined) return { code: 1, stdout: "", stderr: "" };
    if (hit instanceof Error) throw hit;
    return { code: 0, stderr: "", ...hit };
  };
  return { exec, calls };
}
const where = { cwd: "/r", on: null };
const git = (branch, remote) => ({
  "git rev-parse --show-toplevel": { stdout: "/r\n" },
  "git symbolic-ref --short -q HEAD": { stdout: `${branch}\n` },
  "git remote get-url origin": { stdout: `${remote}\n` },
});
```

Tests (one `test` each):
- not a repo → `{ kind: "message", branch: null, text: "Not a git repository" }`.
- detached HEAD (`symbolic-ref` code 1) → text "Not on a branch".
- no `origin`, `git remote` lists `upstream` → uses `git remote get-url upstream`; no remotes at all → "This repo has no remote".
- bitbucket remote → "This repo isn't on GitHub or GitLab".
- GitHub happy path: returns `kind: "prs"`, `provider: "github"`, one PR; the `gh` call's args contain `"--head", "feat/a b;c"` as one element (branch `feat/a b;c`), and every call got `cwd: "/r"`, `on: null`.
- `on: "devbox"` is passed through to every call.
- GitHub empty list → "No pull requests for feat/a".
- `gh` rejects (`new Error("not found")`) → "gh isn't installed".
- `gh` exits 1 with stderr `"error: https://u:tok@github.com/o/r failed\n"` → text "error: https://github.com/o/r failed" (no `tok`).
- `gh` prints `not json` → "Couldn't read gh's answer".
- GitLab happy path with 2 MRs: details fetched for both, pipeline and approvals filled; approvals URL is `projects/99/merge_requests/12/approvals`.
- GitLab with one MR whose `glab mr view` exits 1: that MR has `pipeline: null`, approvals still filled; the other MR complete.
- GitLab with 7 MRs: exactly 5 `glab mr view` calls, the 2 oldest closed ones have `pipeline: null`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test pull-requests/mod/`
Expected: Task 1 tests pass, `load.test.mjs` fails (module not found).

- [ ] **Step 3: Implement `loadPullRequests`** in `pull-requests/mod/load.js`, importing only `./prs.js`.

- [ ] **Step 4: Run the tests**

Run: `node --test pull-requests/mod/`
Expected: all pass.

- [ ] **Step 5: Try it against real repos** with a scratch script (in the scratchpad, not committed) that imports `load.js` and passes a Node `execFile` wrapper as `exec`; run it on `~/Projects/personal/herdr-plugins` (GitHub, expect "No pull requests for main" or PRs) and `~/Projects/playground/customer-panel` on a branch that has an MR (GitLab, expect pipeline and approvals). Fix any field mismatch in Task 1's parsers with a test first.

- [ ] **Step 6: Commit**

```bash
git add pull-requests/mod/load.js pull-requests/mod/load.test.mjs
git commit -m "feat: load the focused branch's PRs through gh and glab"
```

---

### Task 3: the `pull-requests` panel view

**Files:**
- Create: `pull-requests/mod/main.js`, `pull-requests/mod/mod.json` (`{ "place": "none", "title": "Pull requests" }`), `pull-requests/mod/refresh.svg` (24×24 stroke icon, `stroke="currentColor"`, like `changes.svg`), `pull-requests/install.sh`, `pull-requests/README.md`
- Modify: `README.md` (table row), `.gitignore` only if needed

**Interfaces:**
- Consumes: `loadPullRequests` (Task 2); `pipelineLabel`, `approvalsLabel`, `ageLabel` (Task 1).
- Herdr API: `focused()`, `panes()`, `spaces()`, `layout()`, `window()`, `theme()`, `exec`, `checking()` from `"herdr"`; `View`, `div`, `svg` from `"gpui-kit"`; `h_flex`, `v_flex`, `Scrollbar` from `"gpui-base"`; `cx.open_url(url)` in click handlers; `cx.timer.every`, `cx.spawn`, `cx.notify`.

- [ ] **Step 1: Write `main.js`**
  - `location()`: the same logic as Herdr's `changes` mod (`~/.config/herdr-app/mods/changes/main.js`, `function location()`), plus the pane's `branch`; key = `JSON.stringify([on, cwd, branch])`.
  - `shown()`: `layout()` node `panel` not hidden, `panel-body.active === "pull-requests"`, and `window()?.visible !== false`.
  - State: `this.cache = new Map()` key → `{ result, at }`; `this.loading = new Set()` of keys.
  - `init`: unless `checking()`, `cx.timer.every(1000, …)`: if shown and the current key is not loading and (not cached, or `Date.now() - at >= 60000`, or the panel just became shown) → `refresh(key, where, cx)`. Also notify on key change so the header follows focus.
  - `refresh`: add key to `loading`, `cx.spawn` → `await loadPullRequests(where, exec)` → store under *its own* key, remove from `loading`, `cx.notify()`. Render always looks up the *current* key, so a late result for another pane never shows.
  - `render`: root `v_flex` styled like `changes` (`rounded(10)`, `bg(t.background)`, `border_1`, `border_color(t.border)`, `text_size(13)`). Header row: "PRs" + dimmed branch (truncate) + dimmed `ageLabel` when cached + refresh button (spins via `.spin(900)` while loading, `on_click` forces refresh). Body: scrollable list of cards, or one dimmed line: the result's `text`, "Loading…" when nothing cached, "No focused pane" when no `cwd`.
  - Card: line 1 `ref` (dim) + title (truncate), `on_click` → `cx.open_url(pr.url)`, hover `bg(t.hover)`; line 2 `state · source → target` (dim); line 3 when `pipeline`: dot + `pipelineLabel` in the colour from Global Constraints, `on_click` → `cx.open_url(pipeline.url)` when set; line 4 when `approvals`: `approvalsLabel`; blocker in `t.ansi1` when set. Merged/closed cards render with `text_color(t.dim)`.
- [ ] **Step 2: `install.sh`** — like `claude-context/install.sh`, copying `mod.json main.js prs.js load.js refresh.svg` to `~/.config/herdr-app/mods/pull-requests` and running `herdr-app check`.
- [ ] **Step 3: Run** `./pull-requests/install.sh`
  Expected: `herdr-app check` reports no errors.
- [ ] **Step 4: Add the panel to the layout** (the button comes in Task 4; until then open it with `herdr-app` command `layout.select {stack: "panel-body", child: "pull-requests"}` + `layout.show {id: "panel"}` or by editing `panel-body.active`):

```sh
jq '(.. | objects | select(.id == "panel-body") | .children) |= (map(select(.id != "pull-requests")) + [{"id":"pull-requests","type":"block","content":{"mod":"pull-requests"}}])' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json
```

- [ ] **Step 5: Check by hand in Herdr** and note results: GitHub repo pane; GitLab repo pane on a branch with an MR (pipeline + approvals shown, clicks open the browser); non-git folder; switch panes during a fetch (no flash of the other pane's PRs); hide the panel and confirm no `gh`/`glab` processes start (`ps aux | grep -E "gh pr|glab mr"` over a minute).
- [ ] **Step 6: README** — `pull-requests/README.md` in the style of `claude-context/README.md`: what it shows, needs `gh`/`glab` logged in, how it works (branch-based, refresh rules), install (script + the jq above + Task 4's `tabs-prs`), uninstall. Root `README.md` table gets a `pull-requests` row.
- [ ] **Step 7: Commit**

```bash
git add pull-requests README.md
git commit -m "feat: pull requests side panel for the focused pane's branch"
```

---

### Task 4: `tabs-prs` — the PRs button

**Files:**
- Create: `tabs-prs/mod/main.js` (copy of `~/.config/herdr-app/mods/tabs/main.js`), `tabs-prs/mod/mod.json` (`{ "place": "none", "title": "Tabs" }`), `tabs-prs/mod/pull-request.svg`, `tabs-prs/LICENSE` (copy of `workspace-status-lite/LICENSE`), `tabs-prs/install.sh`, `tabs-prs/README.md`
- Modify: `README.md` (table row)

**Interfaces:**
- Consumes: the `pull-requests` block id in `panel-body` (Task 3).

- [ ] **Step 1: Copy and change `main.js`.** Header comment as in `workspace-status-lite/mod/main.js`: "Modified from Herdr's shipped `tabs` mod (version 0.1.18), licensed under the Apache License 2.0 (see ../LICENSE). Change: a PRs panel button after Changes." Only two code changes:
  - `const enabled = [...new Set([...(shared("workspace.panels") ?? ["files", "changes"]), "pull-requests"])];`
  - after the Changes button: `.when(enabled.includes("pull-requests"), el => el.child(panelButton("pull-requests", "PRs", "mods/tabs-prs/pull-request.svg")))`
  Asset paths to `mods/tabs/…`, `mods/files/…`, `mods/changes/…`, `mods/pane/…` stay as they are (those shipped mods stay installed).
- [ ] **Step 2: Icon** `pull-request.svg`: 24×24, `fill="none" stroke="currentColor" stroke-width="1.5"`, two circles and the merge arrow, matching `changes.svg`'s style.
- [ ] **Step 3: `install.sh`** copying `mod.json main.js pull-request.svg` to `~/.config/herdr-app/mods/tabs-prs`, then `herdr-app check`. Run it; expect no errors.
- [ ] **Step 4: Point the layout's tab bar at it:**

```sh
jq '(.. | objects | select(.id == "tabs") | .content.mod) = "tabs-prs"' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json
```

- [ ] **Step 5: Check by hand:** the PRs button sits after Changes and highlights when open; clicking toggles the panel; Files/Changes still work; switching spaces restores each space's panel choice; the tab strip, new-tab "+", right-click menu and tab drag behave as before.
- [ ] **Step 6: README** — `tabs-prs/README.md` in the style of `workspace-status-lite/README.md` (modified copy, licence, install with the jq above, uninstall back to `tabs`). Root `README.md` table row.
- [ ] **Step 7: Commit**

```bash
git add tabs-prs README.md
git commit -m "feat: Herdr tab bar with a PRs panel button"
```
