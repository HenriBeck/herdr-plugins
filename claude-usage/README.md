# claude-usage

A card in the Herdr desktop app's left sidebar showing how much of your Claude
Code **5-hour** (session) and **weekly** limits is used, and when each resets,
worded like Claude Code's `/usage`.

```
 Current session        10% used
 ▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 Resets 5:50pm

 Current week           27% used
 ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░
 Resets Nov 26, 8pm
```

Bars turn orange from 75% used and red from 90%. With the sidebar collapsed it
shows the two percentages; hover them for the details.

## How it works

Claude Code (≥ 2.1.80) passes `rate_limits` to the status line command.
`statusline-tap.sh` wraps your status line (`ccstatusline`): it saves
`rate_limits` to `~/.cache/herdr-claude-usage.json`, then runs `ccstatusline`
with the same input. Every open session reports its own last snapshot, so the
tap merges per window: a later reset wins, then the higher usage. The
`claude-usage` mod reads that file every 15 s and redraws once a minute.
Numbers only refresh while a Claude Code session is running; a window whose
reset time has passed shows as 0% used, "Reset".

## Install

```sh
./claude-usage/install.sh   # copies the mod into Herdr and runs herdr-app check; re-run after edits

# Your own copy of the shipped layout, with the card above the sidebar footer
herdr-app do layout.clone '{"name":"main","as":"main-usage"}'
jq '(.. | objects | select(.id == "sidebar") | .children) |= [ .[] | if .id == "sidebar-footer"
    then ({"id":"claude-usage","type":"block","size":{"px":132},"content":{"mod":"claude-usage"}}, .) else . end ]' \
  ~/.config/herdr-app/layouts/main-usage.json > /tmp/l.json && mv /tmp/l.json ~/.config/herdr-app/layouts/main-usage.json

# Status line: run the tap instead of ccstatusline (back up settings first)
cp ~/.claude/settings.json ~/.claude/settings.json.bak-claude-usage
jq --arg cmd "$PWD/claude-usage/statusline-tap.sh" '.statusLine.command = $cmd' ~/.claude/settings.json > /tmp/s.json \
  && mv /tmp/s.json ~/.claude/settings.json
```

`main-usage` is a clone, so it doesn't receive Herdr's future changes to
`main`. `ctrl-shift-l` switches layouts.

## Uninstall

```sh
herdr-app do layout.switch '{"name":"main"}'
rm -r ~/.config/herdr-app/layouts/main-usage.json ~/.config/herdr-app/mods/claude-usage
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
