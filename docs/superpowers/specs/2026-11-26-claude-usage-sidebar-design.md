# Claude usage in the Herdr sidebar — design

Size: small change.

## Intent

Always see how much of the Claude Code 5-hour limit and weekly (7-day) limit is
left, without leaving the Herdr desktop app. Shown as a small card in the left
sidebar, under the agents list and above the Settings / Add machine footer
(option B).

## Goals

- Two rows: `5h` and `week`, each with a bar, the percentage **left**, and when
  it resets (`1h40m` for the 5h window, weekday + time for the weekly one).
- Colour warns as the limit runs out: normal → `blocked`-ish orange under 25%
  left → red under 10% left (theme colours, so light/dark both work).
- Collapsed sidebar rail (< 160 px): two stacked small numbers (% left), with a
  tooltip giving the full text.
- No credentials touched, no network calls from Herdr.

## Non-goals

- Cost/token accounting (ccusage-style).
- Per-session or per-model breakdown.
- Changing what `ccstatusline` shows in the terminal.

## Anti-goals

- Breaking the Claude Code status line. If the tap fails, `ccstatusline` must
  still run and render exactly as before.
- Battery drain: no animation timers; poll a small file at most every 15 s and
  only while the window is visible.

## Approaches considered

| Approach | Trade-off | Picked |
|---|---|---|
| **Status line tap**: a wrapper around `ccstatusline` saves `rate_limits` from the status line JSON (Claude Code ≥ 2.1.80) to a file; the mod reads it | Documented data, no credentials. Updates only while a Claude Code session is running (usage can't change otherwise) | ✅ |
| Mod calls `api.anthropic.com/api/oauth/usage` with the keychain OAuth token | Always fresh, but undocumented endpoint and reads credentials; blocked by the safety check when tried | ✗ |
| Estimate from local `~/.claude/projects/*.jsonl` (ccusage) | Guesses; limits aren't published as token counts | ✗ |

Placement: Henri picked **B (sidebar card)** over the status bar and a floating pill.

## How it's built

1. **`claude-usage/statusline-tap.sh`** (in this repo, Claude's call):
   reads stdin once, and if it has `.rate_limits`, writes
   `{ "updated_at": <now>, "rate_limits": … }` atomically (tmp + `mv`) to
   `~/.cache/herdr-claude-usage.json`. Then pipes the same stdin into
   `ccstatusline`. `~/.claude/settings.json` `statusLine.command` points at the
   tap instead of `ccstatusline`.
2. **Mod `claude-usage`** (in this repo under `claude-usage/mod/`, symlinked to
   `~/.config/herdr-app/mods/claude-usage`; falls back to a copy if Herdr
   doesn't follow symlinks). `mod.json` `{ "place": "none" }`. Reads the
   JSON file with `readTextFile` on a 15 s timer (skipped while
   `window()?.visible` is false). Accepts `resets_at` as epoch seconds or
   ISO string. A window whose reset time has passed shows as 100% left,
   "reset". No file yet → "Start Claude Code to load usage". Data older than
   30 min → muted "updated 2h ago" line.
3. **Layout**: `herdr-app do layout.clone '{"name":"main","as":"main-usage"}'`
   (switches to it), then insert a block
   `{ "id": "claude-usage", "type": "block", "size": { "px": 72 }, "content": { "mod": "claude-usage" } }`
   between `sidebar-lists` and `sidebar-footer`. Trade-off: the clone stops
   receiving Herdr's updates to `main`; `ctrl-shift-l` switches back anytime.
4. Check with `herdr-app check`, `herdr-app status` and `herdr-app shot`.

## Left to the builder

Exact spacing, font sizes and bar height. Match the existing sidebar look
(`chrome` background, `border` top rule, 13 px text, `muted`/`dim` colours).

## Update (2026-11-26, after first use)

Henri asked for the card to report usage the way Claude Code's `/usage` does,
replacing "% left":

- Rows are labelled `Current session` / `Current week`, show `N% used`, a bar
  that fills with use, and `Resets 18:30` / `Resets Dec 3, 20:00` (24-hour clock).
- Colours: orange from 75% used, red from 90%. A passed reset shows 0% used, `Reset`.
- The collapsed rail shows % used. The block is 132 px tall.
- The tap merges snapshots per window (later reset wins, then higher usage),
  because every open session reports its own last snapshot.
- The mod is installed by copying (`claude-usage/install.sh`); Herdr doesn't
  hot-reload edits made through a symlink.
