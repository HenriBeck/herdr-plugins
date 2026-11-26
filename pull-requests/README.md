# pull-requests

A side panel in the Herdr desktop app, next to Files and Changes, that lists
the pull requests (GitHub) or merge requests (GitLab) of the focused pane's
branch. Each one shows:

- number and title, which open it in the browser
- state (open, draft, merged, closed) and `source → target`
- pipeline status, which opens the pipeline (GitLab) or the checks page (GitHub)
- approvals: who approved, and on GitLab `n of m` required
- what blocks merging, if anything: conflicts or changes requested

Open PRs come first, then merged and closed ones, newest first.

## How it works

The panel takes the focused pane's folder and works out its branch with
`git`. From the `origin` remote's host (or the first remote's) it picks the
provider: `github.com` uses `gh`, any host with `gitlab` in its name uses
`glab`, which covers self-hosted GitLab too. Both CLIs need to be installed
and logged in (`gh auth login`, `glab auth login`). In a space on another
machine they run there.

- **GitHub**: one `gh pr list --head <branch> --state all` call. PRs from
  forks that use the same branch name are left out.
- **GitLab**: `glab mr list --source-branch <branch> --all`, then, for the
  first five MRs, `glab mr view` for the pipeline and the approvals API.

It fetches when the panel opens, when you focus another pane or the branch
changes, every minute while the panel is open, and when you click ⟳. Nothing
runs while the panel is closed or the window is hidden. Each pane's last
answer is kept, so switching back shows it straight away while it refreshes.

The panel never shows remote URLs, and errors from the CLIs are stripped of
credentials before they're shown.

## Install

```sh
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
```

## Tests

```sh
node --test pull-requests/mod/
```
