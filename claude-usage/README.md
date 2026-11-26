# claude-usage

A card in the Herdr desktop app's left sidebar showing how much of your Claude
Code **5-hour** and **weekly** limits is left, and when each resets.

```
 5h    ▓▓▓▓▓▓▓▓▓░  95%   3h18m
 week  ▓▓▓▓▓▓▓░░░  74%   Thu 20:00
```

Bars turn orange under 25% left and red under 10%. With the sidebar collapsed
it shows the two numbers; hover them for the details.

## How it works

Claude Code (≥ 2.1.80) passes `rate_limits` to the status line command.
`statusline-tap.sh` wraps your status line (`ccstatusline`): it saves
`rate_limits` to `~/.cache/herdr-claude-usage.json`, then runs `ccstatusline`
with the same input. The `claude-usage` mod reads that file every 15 s.
Numbers only refresh while a Claude Code session is running; a window whose
reset time has passed shows as 100% left.

## Install

```sh
ln -s "$PWD/claude-usage/mod" ~/.config/herdr-app/mods/claude-usage
herdr-app check ~/.config/herdr-app/mods/claude-usage

# Your own copy of the shipped layout, with the card above the sidebar footer
herdr-app do layout.clone '{"name":"main","as":"main-usage"}'
jq '(.. | objects | select(.id == "sidebar") | .children) |= [ .[] | if .id == "sidebar-footer"
    then ({"id":"claude-usage","type":"block","size":{"px":72},"content":{"mod":"claude-usage"}}, .) else . end ]' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json

# Status line: run the tap instead of ccstatusline
jq --arg cmd "$PWD/claude-usage/statusline-tap.sh" '.statusLine.command = $cmd' ~/.claude/settings.json > /tmp/s.json \
  && mv /tmp/s.json ~/.claude/settings.json
```

`main-usage` is a clone, so it doesn't receive Herdr's future changes to
`main`. `ctrl-shift-l` switches layouts.

## Uninstall

```sh
herdr-app do layout.switch '{"name":"main"}'
rm ~/.config/herdr-app/layouts/main-usage.json ~/.config/herdr-app/mods/claude-usage
jq '.statusLine.command = "ccstatusline"' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json
rm -f ~/.cache/herdr-claude-usage.json
```

## Tests

```sh
bash claude-usage/test/tap.test.sh
node --test claude-usage/mod/
```

Env overrides for the tap: `HERDR_CLAUDE_USAGE_FILE` (data file),
`CLAUDE_USAGE_NEXT` (status line command, default `ccstatusline`).
