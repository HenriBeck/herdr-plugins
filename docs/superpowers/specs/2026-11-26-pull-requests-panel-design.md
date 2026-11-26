# Pull requests panel in Herdr — design

Size: project (two Herdr mods, a layout change, two providers).

## Intent

From the focused Herdr pane, see the pull requests (GitHub) or merge requests
(GitLab) of the branch it is on, with a short status report for each:
pipeline, approvals, and whether it's open, draft, merged or closed. It opens
like Herdr's Files and Changes panels, from a button at the top. Opening the
repository or branch page is not the point; the PRs and their state are.

Starting point is the branch. Henri wants to see how it's used before going
further (for example tracking every PR a Claude session opened, across branches
or repos).

## Goals

- A "PRs" button next to Files and Changes at the top opens the right-hand
  panel showing the `pull-requests` mod. It toggles and is remembered per
  space exactly like the other two.
- The panel follows the focused pane: its folder and git branch decide what
  is shown. Switching panes switches the list.
- Works for GitHub and GitLab (including self-hosted GitLab), using the `gh`
  and `glab` CLIs and the logins they already have.
- Lists every PR whose source branch is the pane's branch, in all states:
  open and draft first, then merged and closed, newest first within each group.
- Each PR shows: number and title, state, `source → target`, pipeline status,
  approvals (who approved; for GitLab also `n of m required`), and a
  merge blocker when there is one (conflicts, changes requested).
- Clicking the PR opens it in the browser; clicking the pipeline line opens
  the pipeline (GitLab) or the PR's checks page (GitHub).

## Non-goals (for now)

- PRs a session created on other branches or in other repos.
- Creating, approving, merging or commenting on PRs from the panel.
- Notifications when a pipeline finishes or a PR gets approved.
- Hosts other than GitHub and GitLab (Bitbucket etc.).

## Anti-goals

- Slowing Herdr down or hammering the APIs: no fetching while the panel is
  hidden or the window is in the background.
- Showing a remote URL. Some remotes carry credentials in the URL
  (`https://user:token@host/...`); the panel never displays, logs or stores
  the remote URL, only the PR data the CLIs return.
- A panel that freezes the UI: every `exec` runs off the render path.

## Approaches

| Approach | Trade-off | Picked |
|---|---|---|
| **A. Copy Herdr's `tabs` mod and add a "PRs" button; new `pull-requests` panel mod in the `panel-body` stack; data from `gh` / `glab`** | Sits exactly where Files and Changes are and behaves like them. The copy of `tabs` misses future Herdr changes to it (same deal as `workspace-status-lite`) | ✅ Henri's pick |
| B. Same panel, button in the bottom bar next to the branch | No `tabs` copy to maintain, but not at the top where Henri wants it, and panel buttons end up in two places | ✗ |
| C. Like A, but calling the GitHub / GitLab REST APIs directly | One code path, but tokens and self-hosted hosts become our problem; the CLIs already solve both | ✗ |

## How it's built

### Repo layout

Same shape as the existing plugins:

- `tabs-prs/` — the copied tabs bar. `mod/` holds `mod.json`, `main.js`,
  the PR icon; `LICENSE` (Herdr's Apache 2.0, as for `workspace-status-lite`),
  `install.sh`, `README.md`.
- `pull-requests/` — the panel. `mod/` holds `mod.json` (`{ "place": "none" }`),
  `main.js` (view), `prs.js` (pure parsing and summarising), `prs.test.mjs`
  (`node --test`), `install.sh`, `README.md`.
- Root `README.md` table gets both rows.

### `tabs-prs` (copy of Herdr's `tabs`, version 0.1.18)

- Copied unchanged except: a third `panelButton("pull-requests", "PRs", <icon>)`
  after Changes, and `"pull-requests"` added to the enabled panel list
  (`[...(shared("workspace.panels") ?? ["files", "changes"]), "pull-requests"]`,
  without duplicates).
- Header comment states it's modified from Herdr's `tabs` (version, licence,
  what changed), like `workspace-status-lite`.

### Layout (`~/.config/herdr-app/layouts/main-usage.json`)

- The `tabs` block's content becomes `{ "mod": "tabs-prs" }`.
- `panel-body` gets a third child:
  `{ "id": "pull-requests", "type": "block", "content": { "mod": "pull-requests" } }`.
- The README explains this edit (the layout lives outside the repo).

### `pull-requests` panel

**Where it looks.** The focused pane's `cwd` and `branch` from `panes()` /
`focused()`, and its machine (`on`), the same way Herdr's `changes` mod works
out its `location()`. `exec` runs with `cwd` and `on`, so remote spaces work
when `gh` / `glab` are installed and logged in on that machine.

**Which provider.**
1. `git remote get-url origin` (fall back to the first of `git remote`).
2. Parse the host (SSH `git@host:path` and `https://[userinfo@]host/path`);
   drop userinfo immediately.
3. `github.com` → GitHub. A host containing `gitlab` → GitLab. Otherwise
   → "This repo isn't on GitHub or GitLab".

**GitHub** — one call:
`gh pr list --head <branch> --state all --limit 20 --json number,title,state,isDraft,headRefName,baseRefName,url,reviewDecision,latestReviews,statusCheckRollup,mergeable,updatedAt`.
- Pipeline: summarise `statusCheckRollup` into `passed` / `failed` /
  `running` / `none` (any failure → failed; else any pending → running; else
  passed if any checks).
- Approvals: authors of `latestReviews` with state `APPROVED`;
  `reviewDecision` gives `approved` / `changes requested` / `review required`.
- Blocker: `mergeable == "CONFLICTING"` → conflicts; `CHANGES_REQUESTED`.

**GitLab** — list, then details per MR:
- `glab mr list --source-branch <branch> --all -F json --per-page 20`.
- For each MR (at most 5, open ones first):
  `glab mr view <iid> -F json` → `head_pipeline.status` and `.web_url`,
  `detailed_merge_status`, `has_conflicts`;
  `glab api projects/:id/merge_requests/<iid>/approvals` → `approved_by[].user.name`,
  `approvals_required`, `approvals_left`.
- The details calls for one refresh run in parallel.

**When it fetches.**
- When the panel is shown, when the focused pane's `(machine, cwd, branch)`
  changes, every 60 s while the panel is shown and the window is visible, and
  from a refresh button in the panel header.
- Results are cached per `(machine, repo root, branch)` so switching back to a
  pane shows the last result straight away (marked with its age) while a
  refresh runs.
- A fetch whose key is no longer the focused one is dropped when it lands.

**What it shows when there's nothing to show.** One quiet line for each:
no focused pane, not a git repo, no remote, unsupported host, `gh` / `glab`
not installed, not logged in (first line of the CLI's stderr), no PRs for
this branch, loading, other error (first line of stderr). Never a stack trace.

**Look.** Matches Files / Changes: header with the branch name and refresh
button; one card per PR. Colours from the theme: pipeline passed → accent,
running → muted, failed → `ansi1` (as claude-context uses for critical);
merged → dimmed, closed → dimmed and struck title or "closed" label.

```
 PRs · feat/effort                ⟳
┌──────────────────────────────────┐
│ !1423  Add bottom-bar effort     │
│ open · feat/effort → main        │
│ ● pipeline passed                │
│ ✓ 1 of 2 approvals · Jane Doe    │
├──────────────────────────────────┤
│ !1419  Fix usage card height     │
│ merged · feat/effort → main      │
└──────────────────────────────────┘
```

### Tests

`prs.js` holds everything that isn't I/O and is tested with `node --test`,
following `claude-context/mod/context.test.mjs`: remote URL → host (SSH,
HTTPS, userinfo stripped, unknown host), provider pick, GitHub JSON →
PR summaries (check rollup cases, reviews), GitLab JSON → PR summaries
(pipeline, approvals, conflicts), sorting.

## Calls made while writing this up (Claude's, not Henri's)

- **Forks on GitHub:** `--head` also matches other people's fork PRs with the
  same branch name; keep only PRs whose head is this repo
  (`isCrossRepository == false`, or `headRepositoryOwner` matches).
- **Errors are scrubbed:** the stderr line shown in empty states has any
  `user:token@` userinfo removed first.
- **"Visible" means `window().visible`:** the 60 s refresh pauses when the
  window isn't visible.
- **More than five GitLab MRs:** the rest show without pipeline and approvals.
- **Detached HEAD:** its own empty-state line ("Not on a branch").
- **Panel memory resets once:** `tabs-prs` keeps its own per-space "which
  panel was open" memory, so after switching the layout over, each space
  starts with the panel closed.

## Left to the builder

- How the panel knows it's shown (reading `layout()` for `panel` hidden and
  `panel-body.active`, as `tabs` does, is the obvious route).
- Exact spacing, icon, card layout and wording of the empty states.
- The `:id` resolution for `glab api` (it resolves from `cwd`; if that fails,
  use `project_id` from the list output).
