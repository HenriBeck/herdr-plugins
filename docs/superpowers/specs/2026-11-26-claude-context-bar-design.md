# Claude context in the Herdr bottom bar — design

Size: small change. Henri chose to skip the questions and build it ("let's build it").

## Intent

See the focused Claude Code session's context window (and a bit more) in
Herdr's bottom bar, under the panes. Longer term this bar replaces
`ccstatusline`, Claude Code's status line, which today shows model, context
length, git branch and git changes.

## Goals

- The bar's right side shows, for the Claude Code session in the focused pane:
  model, a small context bar with `% · used / window` tokens, and the session's
  estimated cost.
- Follows focus: switching panes switches the figures; a pane without Claude
  Code shows nothing.
- Same colour rule as the usage card: orange from 75% full, red from 90%.

## Non-goals (for now)

- Git changes in the bar (`ccstatusline`'s last item). Herdr's bar already
  shows the branch. Changes are the next step before dropping the status line.
- Removing `ccstatusline`. That is Henri's call once the bar covers it.

## Approaches

| Approach | Trade-off | Picked |
|---|---|---|
| **Claude Code plugin writes one file per Herdr terminal** (`HC_TERMINAL_ID`), Herdr mod reads the focused one | Exact pane ↔ session match; no shared file, so no merge or write races | ✅ (Claude's call) |
| One shared file keyed by terminal | Concurrent sessions rewrite the same file; `$.fs.write` isn't atomic | ✗ |
| Match sessions by cwd | Two sessions in one folder are ambiguous | ✗ |

## How it's built

- **Plugin `herdr-claude-context`** (`claude-context/claude-code-mod/`): on
  `session.start`, `session.measure` and `session.end` it writes
  `$HOME/.cache/herdr-claude-context/<HC_TERMINAL_ID>.json`
  (`$HERDR_CLAUDE_CONTEXT_DIR` overrides the folder):
  `{ updated_at, session_id, model, context: { tokens, window, percent }, cost_usd, ended }`.
  Outside Herdr (no `HC_TERMINAL_ID`) it does nothing. Skips writes when
  nothing changed. `/clear` resets the figures to empty; another end marks
  `ended: true` (`$.fs` has no delete). Failures never disturb the session.
- **Herdr mod `claude-context`** (`claude-context/mod/`): reads the focused
  terminal's file every second while the window is visible (a tiny file; redraws
  only when it changed). `render` re-runs on focus changes. Shows nothing when
  the focused terminal isn't a live agent, has no file, or the file says `ended`.
- **Layout**: in `main-usage`, the 28 px `status` block becomes a row
  `status-row` holding `status` (`workspace-status`, weight 1) and
  `claude-context` (fixed width), both drawn on `chrome` with a top border so
  it reads as one bar.

## Left to the builder

Exact width, spacing and token formatting (`84k / 200k`, `1M`).
