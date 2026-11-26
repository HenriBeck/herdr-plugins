# repo-link

A **GitHub** or **GitLab** button at the right end of Herdr's tab bar. It
opens the focused pane's repository in your browser.

The repository comes from the pane folder's `origin` remote, or its first
remote if there's no `origin`. SSH, scp-like (`git@host:owner/repo.git`) and
HTTPS remotes all work. GitHub means `github.com`; any host with "gitlab" in its
name counts as GitLab, so self-hosted GitLab works too. With no remote, or a
remote somewhere else, there's no button. Hover the button to see the
repository's path.

It only needs `git`: no `gh`, `glab` or login. Each folder's remote is looked
up again after a minute, so a changed remote shows up without a restart.

## Install

```sh
./repo-link/install.sh   # copies the mod into Herdr and runs herdr-app check

# Put it beside your layout's tab bar (here main-usage, a clone of main: see ../claude-usage)
layout=~/.config/herdr-app/layouts/main-usage.json
jq '(.. | objects | select(.id == "work") | .children) |= [ .[] | if .id == "tabs"
    then {"id":"tabs-row","type":"row","size":{"px":42},"children":[(.size = {"weight":1}),
      {"id":"repo-link","type":"block","size":{"px":88},"window_drag":true,"content":{"mod":"repo-link"}}]}
    else . end ]' \
  "$layout" > /tmp/l.json && mv /tmp/l.json "$layout"
```

`window_drag` keeps the empty part of the block dragging the window, like the
rest of the tab bar.

## Uninstall

```sh
layout=~/.config/herdr-app/layouts/main-usage.json
jq '(.. | objects | select(.id == "work") | .children) |= [ .[] | if .id == "tabs-row"
    then (.children[] | select(.id == "tabs") | .size = {"px":42}) else . end ]' \
  "$layout" > /tmp/l.json && mv /tmp/l.json "$layout"
rm -r ~/.config/herdr-app/mods/repo-link
```
