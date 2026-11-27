# pull-requests

A side panel in the Herdr desktop app, next to Files and Changes, that lists
the pull requests (GitHub) or merge requests (GitLab) of the focused pane's
branch. Each one shows:

- number and title, which open it in the browser
- state (open, draft, merged, closed) and `source → target`
- pipeline status, which opens the pipeline (GitLab) or the checks page (GitHub)
- approvals: who approved, and on GitLab `n of m` required
- what blocks merging, if anything: conflicts or changes requested

With the `herdr-claude-prs` plugin it also lists the PRs the Claude Code
conversation in that pane created, in any repo (see Session PRs below). Every
card shows its repo's name; cards of the pane's own repo (any of its remotes)
have an accent strip on the left and come first, the pane branch's at the top.
When the branch itself has no PRs, that message shows as one line above the
session's. A session PR that can't be fetched shows its number, repo and the
error.

Open PRs come first, then merged and closed ones, newest first.

## How it works

The panel takes the focused pane's folder and works out its branch with
`git`. From the `origin` remote's host (or the first remote's) it picks the
provider: `github.com` uses `gh`, any host with `gitlab` in its name uses
`glab`, which covers self-hosted GitLab too. Both CLIs need to be installed
and logged in (`gh auth login`, `glab auth login`). In a space on another
machine they run there.

- **GitHub**: one `gh pr list --head <branch> --state all` call. PRs from
  other people's forks that use the same branch name are left out; PRs from
  a fork owned by the remote's owner (working from your own fork) stay.
- **GitLab**: `glab mr list --source-branch <branch> --all`, then, for the
  first five MRs, `glab mr view` for the pipeline and the approvals API.

It fetches when the panel opens, when you focus another pane or the branch
changes, every minute while the panel is open, and when you click ⟳. Nothing
runs while the panel is closed or the window is hidden. The last answer for
each repo and branch is kept, so switching back to a pane, or moving to another
folder in the same repo, shows it straight away; it's refreshed unless it's
only seconds old.

## Session PRs

With the Claude Code plugin `herdr-claude-prs` (in `claude-code-mod/`), the
panel also lists the PRs and MRs the Claude Code conversation in the focused
pane created, in any repo. The plugin records the PR link when a
`gh pr create` or `glab mr create` command succeeds, or a GitHub/GitLab MCP
tool creates one (`create_pull_request`, `create_merge_request`,
`save_merge_request` without an MR number). Subagents' creates count too.

It keeps each conversation's links in
`~/.cache/herdr-claude-prs/sessions/<session id>.json` (the 20 newest) and
copies the list of the conversation now running in a Herdr terminal to
`~/.cache/herdr-claude-prs/<terminal id>.json`, which the panel reads. The PRs
follow the conversation: `claude --resume` brings them back, `/clear` starts
an empty list, and after `/resume` inside a running session they show from
your next prompt on.

Not recorded for now: a create run in the background, a command chain that
fails after the create (`gh pr create … && gh pr merge --auto` failing), and
`gh`'s "already exists" message.

The panel never shows remote URLs, and errors from the CLIs are stripped of
credentials before they're shown.

## Install

```sh
# The Claude Code plugin, for session PRs (from a clone of this repo)
claude plugin marketplace add "$PWD"
claude plugin install herdr-claude-prs@herdr-plugins

./pull-requests/install.sh   # copies the mod into Herdr and runs herdr-app check; re-run after edits

# Add the panel to your layout's side panel (here main-usage, a clone of main: see ../claude-usage)
jq '(.. | objects | select(.id == "panel-body") | .children) |= (map(select(.id != "pull-requests"))
    + [{"id":"pull-requests","type":"block","content":{"mod":"pull-requests"}}])' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json
```

The "PRs" button at the top comes from [tabs-prs](../tabs-prs/). Without it,
open the panel with:

```sh
herdr-app do layout.select --stack panel-body --child pull-requests
herdr-app do layout.show --id panel
```

## Uninstall

```sh
jq '(.. | objects | select(.id == "panel-body") | .children) |= map(select(.id != "pull-requests"))' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json
rm -r ~/.config/herdr-app/mods/pull-requests
claude plugin uninstall herdr-claude-prs@herdr-plugins
```

## Tests

```sh
node --test pull-requests/mod/
claude plugin test pull-requests/claude-code-mod
```
