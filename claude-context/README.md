# claude-context

The right end of the Herdr desktop app's bottom bar shows the Claude Code
session in the focused pane: its model and the effort it runs at, how full its
context window is, and what it has cost so far.

<img src="../docs/screenshots/bottom-bar.png" width="985" alt="Bottom bar: on the right, Opus 5.5, high, a context bar at 8%, 82k / 1M, $0.58">

The bar turns orange from 75% full and red from 90%. Hover it for exact token
counts. The cost is Claude Code's own estimate (what `/cost` shows), not a bill.
A pane without Claude Code shows nothing.

## How it works

Two parts:

- **`claude-code-mod/`**: a Claude Code plugin (`herdr-claude-context`). When
  a session starts, after every turn, and when it ends, it saves the session's
  figures to `~/.cache/herdr-claude-context/<terminal>.json`, named after the
  Herdr terminal it runs in (`$HC_TERMINAL_ID`). The effort comes from the
  session's latest model request, so it shows after the first prompt and
  follows `/effort` changes from the next request on. Outside Herdr it does
  nothing. `/clear` empties the figures; quitting marks the file ended.
- **`mod/`**: the Herdr mod. It reads the focused terminal's file every second
  while the window is visible, and redraws when the file or the focus changes.

## Install

The Claude Code plugin, from a clone of this repo:

```sh
claude plugin marketplace add "$PWD"
claude plugin install herdr-claude-context@herdr-plugins
```

or straight from GitHub, at the prompt of a Claude Code session:

```
/plugin install herdr-claude-context --marketplace HenriBeck/herdr-plugins
```

Sessions that were already open pick it up after a restart or `/reload-plugins`.

The Herdr bar:

```sh
./claude-context/install.sh   # copies the mod into Herdr and runs herdr-app check; re-run after edits

# In your own layout (here main-usage, a clone of main: see ../claude-usage),
# split the bottom bar into Herdr's status and this block
jq '(.. | objects | select(.id == "work") | .children) |= [ .[] | if .id == "status"
    then {"id":"status-row","type":"row","size":{"px":28},"children":[(.size = {"weight":1}),
      {"id":"claude-context","type":"block","size":{"px":360},"content":{"mod":"claude-context"}}]}
    else . end ]' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json
```

## Uninstall

```sh
claude plugin uninstall herdr-claude-context@herdr-plugins
jq '(.. | objects | select(.id == "work") | .children) |= [ .[] | if .id == "status-row"
    then (.children[] | select(.id == "status") | .size = {"px":28}) else . end ]' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json
rm -r ~/.config/herdr-app/mods/claude-context ~/.cache/herdr-claude-context
```

## Tests

```sh
claude plugin test claude-context/claude-code-mod
node --test claude-context/mod/
```

`HERDR_CLAUDE_CONTEXT_DIR` overrides the folder the Claude Code plugin saves to.
