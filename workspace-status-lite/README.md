# workspace-status-lite

Herdr's bottom bar (`workspace-status`) without the "⌘⇧P commands" shortcut
hint on the right, which leaves room for [claude-context](../claude-context/).

<img src="../docs/screenshots/bottom-bar.png" width="985" alt="Bottom bar: This computer, branch main, 8 agents on the left, with claude-context on the right where the shortcut hint used to be">

It's a modified copy of the mod Herdr ships (version 0.1.18), so it doesn't
receive Herdr's later changes to the original. Herdr is licensed under the
Apache License 2.0; a copy is in [LICENSE](LICENSE).

## Install

```sh
./workspace-status-lite/install.sh   # copies the mod into Herdr and runs herdr-app check

# Point your layout's bottom bar at it (here main-usage, a clone of main: see ../claude-usage)
jq '(.. | objects | select(.id == "status") | .content.mod) = "workspace-status-lite"' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json
```

## Uninstall

```sh
jq '(.. | objects | select(.id == "status") | .content.mod) = "workspace-status"' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json
rm -r ~/.config/herdr-app/mods/workspace-status-lite
```
