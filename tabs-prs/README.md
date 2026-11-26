# tabs-prs

Herdr's tab bar (`tabs`) with a third side-panel button, **PRs**, after Files
and Changes. It opens the [pull-requests](../pull-requests/) panel, and like
the other two it toggles and is remembered per space.

It's a modified copy of the mod Herdr ships (version 0.1.18), so it doesn't
receive Herdr's later changes to the original. Herdr is licensed under the
Apache License 2.0; a copy is in [LICENSE](LICENSE). The copy keeps its own
memory of which panel each space had open, so after switching to it every
space starts once with the side panel closed.

## Install

Install [pull-requests](../pull-requests/) first (the button opens its block), then:

```sh
./tabs-prs/install.sh   # copies the mod into Herdr and runs herdr-app check

# Point your layout's tab bar at it (here main-usage, a clone of main: see ../claude-usage)
jq '(.. | objects | select(.id == "tabs") | .content.mod) = "tabs-prs"' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json
```

## Uninstall

```sh
jq '(.. | objects | select(.id == "tabs") | .content.mod) = "tabs"' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json
rm -r ~/.config/herdr-app/mods/tabs-prs
```
