# Claude Usage Sidebar Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the Claude Code 5-hour and weekly limits (% left and when each resets) as a card in the Herdr desktop app's left sidebar.

**Architecture:** A bash wrapper sits in front of `ccstatusline` as the Claude Code status line command. It saves `rate_limits` from the status line JSON to `~/.cache/herdr-claude-usage.json`. A Herdr mod (`claude-usage`) polls that file and draws the card. A cloned layout `main-usage` places the mod between the agents list and the sidebar footer.

**Tech Stack:** bash + jq (tap), JavaScript gpui-kit / `herdr` module (mod), `node --test` for the mod's pure logic, `herdr-app check` / `status` / `shot` for the UI.

**Spec:** `docs/superpowers/specs/2026-11-26-claude-usage-sidebar-design.md`

## Global Constraints

- The status line must keep working: `ccstatusline` gets the exact same stdin and its output and exit code pass through unchanged, even if saving usage fails.
- Data file: `~/.cache/herdr-claude-usage.json`, written atomically (tmp file in same dir + `mv`). Shape: `{ "updated_at": <epoch seconds>, "rate_limits": <verbatim .rate_limits> }`.
- Status line input shape: `.rate_limits.five_hour` / `.rate_limits.seven_day`, each `{ used_percentage: number, resets_at: number (epoch s) | string (ISO 8601) }`.
- Display **% left** = `clamp(100 - used_percentage, 0, 100)`, rounded to integer.
- Colour levels: left ≥ 25 → `accent`; 10 ≤ left < 25 → `blocked`; left < 10 → `ansi1` (red). Theme colours only.
- Rail mode when the `sidebar` node's `size.px` < 160 (same rule as `mods/workspace-chrome/main.js`).
- Poll the file every 15 000 ms, skip when `window()?.visible === false`. No animation timers.
- Stale threshold: 30 min since `updated_at`.
- Copy: empty state `Start Claude Code to load usage`; row labels `5h`, `week`; past reset shows `reset`.
- Never edit Herdr's shipped files (`layouts/main.json`, `mods/workspace-*`, `AGENTS.md`, `.d.ts`).

## Review Focus

1. Status line input without `rate_limits` (session's first render, API-key login): the tap must leave the existing file alone, not overwrite it with null.
2. A corrupt or empty data file: the card shows the empty state rather than throwing.
3. `resets_at` already in the past (Herdr open overnight with no Claude running): that row shows 100% left, `reset`.
4. `resets_at` as epoch seconds vs ISO string: both parse to the same time.
5. Only one window present, or `used_percentage` > 100: missing row shows `—`; left clamps to 0.

---

## File Structure

```
herdr-plugins/
  claude-usage/
    statusline-tap.sh          # status line wrapper (Task 1)
    test/tap.test.sh           # bash tests for the tap (Task 1)
    mod/                       # symlinked to ~/.config/herdr-app/mods/claude-usage
      mod.json                 # { "place": "none" }
      usage.js                 # pure logic, no imports (Task 2)
      usage.test.mjs           # node --test (Task 2)
      main.js                  # the View (Task 3)
    README.md                  # install / uninstall (Task 4)
```

`usage.test.mjs` lives in the mod folder so the import path is trivial. Herdr only loads `main.js` and what it imports, so the extra file is harmless.

---

### Task 1: Repo + status line tap

**Files:**
- Create: `claude-usage/statusline-tap.sh` (executable)
- Create: `claude-usage/test/tap.test.sh` (executable)
- Create: `.gitignore` (`.DS_Store`)

**Interfaces:**
- Produces: `statusline-tap.sh`, which reads stdin and writes the data file described in Global Constraints. Env overrides for testing: `HERDR_CLAUDE_USAGE_FILE` (default `$HOME/.cache/herdr-claude-usage.json`) and `CLAUDE_USAGE_NEXT` (default `ccstatusline`, run via `exec` with stdin re-fed).

- [ ] **Step 1: `git init` in the repo root, add `.gitignore`, commit the spec and the plan**

- [ ] **Step 2: Write `test/tap.test.sh`.** It's plain bash with a `fail()` helper. Each case uses a `mktemp -d` dir for the data file, plus `CLAUDE_USAGE_NEXT="cat"` so the passthrough can be asserted. Cases:
  - `writes_rate_limits`: input `{"rate_limits":{"five_hour":{"used_percentage":38,"resets_at":1795700000},"seven_day":{"used_percentage":82,"resets_at":1796000000}}}`. Assert stdout == input, and assert the file's `.rate_limits.five_hour.used_percentage == 38` and `.updated_at` is a number within 5 s of `date +%s`.
  - `keeps_file_without_rate_limits`: pre-write a file with `used_percentage` 10, feed `{"model":{}}`. Assert the file is unchanged and stdout == input.
  - `survives_unwritable_dir`: point `HERDR_CLAUDE_USAGE_FILE` at `/nonexistent/x.json`. Assert exit 0 and stdout == input.
  - `passes_exit_code`: `CLAUDE_USAGE_NEXT="sh -c 'cat >/dev/null; exit 3'"`. Assert exit code 3.

- [ ] **Step 3: Run `bash claude-usage/test/tap.test.sh`.** Expected: fails (script missing).

- [ ] **Step 4: Implement `statusline-tap.sh`.** Read stdin into a variable. Pull `.rate_limits` with `jq -c` (errors to /dev/null). If it's non-null, write `{updated_at: now, rate_limits}` to `mktemp "$dir/.herdr-claude-usage.XXXX"` and `mv` it into place, all in a `{ …; } 2>/dev/null || true` group. Then `printf '%s' "$input" | eval "$CLAUDE_USAGE_NEXT"`, which keeps its exit code. Do not use `set -e`.

- [ ] **Step 5: Run `bash claude-usage/test/tap.test.sh`.** Expected: `all tap tests passed`.

- [ ] **Step 6: Commit** `feat: status line tap saving Claude rate limits`

### Task 2: Usage logic (pure)

**Files:**
- Create: `claude-usage/mod/usage.js`
- Test: `claude-usage/mod/usage.test.mjs`

**Interfaces:**
- Produces (ES module exports, no imports):
  - `parseUsage(text: string | null, nowMs: number) -> { state: "missing" } | { state: "ok", updatedAtMs: number, stale: boolean, rows: Row[] }`
  - `Row = { key: "five_hour" | "seven_day", label: "5h" | "week", left: number | null, resetsAtMs: number | null, reset: boolean, level: "ok" | "low" | "critical" | "none" }`
  - `formatReset(row: Row, nowMs: number) -> string`: `"reset"` if `row.reset`, `""` if no time. For `five_hour`: `"1h40m"` / `"12m"`. For `seven_day`: `"<Weekday> HH:MM"` in local time (`toLocaleString("en-GB", {weekday:"short", hour:"2-digit", minute:"2-digit", hour12:false})`, which gives e.g. `"Mon 09:00"`).
  - `formatAge(updatedAtMs: number, nowMs: number) -> string`: `"updated 45m ago"` / `"updated 2h ago"` / `"updated 3d ago"`.
  - `toMs(v: number | string | null | undefined) -> number | null`: numbers < 1e12 are seconds ×1000. Strings go through `Date.parse`. Anything else, or NaN, gives null.

- [ ] **Step 1: Write `usage.test.mjs`** with `node:test` + `node:assert/strict`, using `NOW = Date.parse("2026-11-26T12:00:00Z")`:
  - `missing on null / "" / "{not json" / "{}"`: `state === "missing"`.
  - `left and level`: used 38 → left 62, `ok`. Used 80 → 20, `low`. Used 95 → 5, `critical`. Used 140 → 0, `critical`.
  - `row order and labels`: rows are `[five_hour "5h", seven_day "week"]`.
  - `missing window`: only `five_hour` given, so the `seven_day` row has `left === null` and `level === "none"`.
  - `past reset`: `resets_at` = NOW − 60 s, so `reset === true`, `left === 100`, `level === "ok"`, and `formatReset` gives `"reset"`.
  - `epoch vs ISO`: `toMs(1795700000) === toMs(new Date(1795700000000).toISOString())`.
  - `stale`: `updated_at` = NOW/1000 − 31·60 gives `stale === true`. 29·60 gives `false`.
  - `formatReset five_hour`: resets NOW + 100 min → `"1h40m"`. NOW + 12 min → `"12m"`.
  - `formatAge`: 45 min → `"updated 45m ago"`. 125 min → `"updated 2h ago"`.

- [ ] **Step 2: Run `node --test claude-usage/mod/`.** Expected: fails (module not found).

- [ ] **Step 3: Implement `usage.js`** to the interfaces above.

- [ ] **Step 4: Run `node --test claude-usage/mod/`.** Expected: all pass.

- [ ] **Step 5: Commit** `feat: claude usage parsing and formatting`

### Task 3: The card mod

**Files:**
- Create: `claude-usage/mod/mod.json` → `{ "place": "none" }`
- Create: `claude-usage/mod/main.js`
- Link: `ln -s "$PWD/claude-usage/mod" ~/.config/herdr-app/mods/claude-usage`

**Interfaces:**
- Consumes: `parseUsage`, `formatReset`, `formatAge` from `./usage.js`. From `herdr`: `readTextFile`, `home`, `theme`, `layout`, `window`, `checking`.
- Produces: mod name `claude-usage`, no props.

- [ ] **Step 1: Implement `main.js`.** Use `export default class ClaudeUsage extends View`.
  - `init`: `this.text = null`, then `load(cx)`, then `cx.timer.every(15000, cx => { if (window()?.visible !== false) this.load(cx); })`. `load` runs `cx.spawn(async cx => { this.text = await readTextFile(home() + "/.cache/herdr-claude-usage.json").catch(() => null); cx.notify(); })`.
  - `render`: `const u = parseUsage(this.text, Date.now())`. Narrow test is the `find(layout(), "sidebar")` rule from `mods/workspace-chrome/main.js`. Root is `v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border)`, with padding matching the footer (`px(16).py(8)`) and text 12 px.
  - Wide, `ok`: per row, an `h_flex` with the label (w 36, `muted`), a bar (`flex_1`, h 6, rounded 3, track `t.hover`, fill width = `left%` coloured by level), `${left}%` (w 36, right-aligned, `foreground`), and `formatReset` (`dim`). A row with `left === null` shows `—`. If `stale`, add a `dim` 11 px line with `formatAge`.
  - Wide, `missing`: one `dim` line, `Start Claude Code to load usage`.
  - Rail: centred `v_flex` of two 11 px numbers coloured by level, `.id("usage-rail").tooltip("5h 62% left · 1h40m\nweek 18% left · Mon 09:00")`.

- [ ] **Step 2: Symlink and run `herdr-app check ~/.config/herdr-app/mods/claude-usage`.** Expected: exit 0. If it reports that it can't resolve the symlink, replace the link with a copy and note that in the README (Task 4).

- [ ] **Step 3: Commit** `feat: claude-usage Herdr mod`

### Task 4: Wire it in

**Files:**
- Create via command: `~/.config/herdr-app/layouts/main-usage.json`
- Modify: `~/.claude/settings.json`, `statusLine.command` (back up first to `settings.json.bak-claude-usage`)
- Create: `claude-usage/README.md`

- [ ] **Step 1: Run `herdr-app do layout.clone '{"name":"main","as":"main-usage"}'`.** Expected: JSON without `error`. `herdr-app status` shows `"layout": "main-usage"`.

- [ ] **Step 2: Insert the block** into `layouts/main-usage.json` with `jq`. The `sidebar` column's children become `brand`, `sidebar-lists`, then the new block, then `sidebar-footer`. New block: `{ "id": "claude-usage", "type": "block", "size": { "px": 72 }, "content": { "mod": "claude-usage" } }`. Then check `ls ~/.config/herdr-app/layouts/*.error` (expect none) and that `herdr-app status` has `"errors": []`.

- [ ] **Step 3: Point the status line at the tap.** Set `statusLine.command` to the absolute path of `claude-usage/statusline-tap.sh` with `jq` (keep `refreshInterval: 10` and the other fields). Ask the user to send one message in any Claude Code session, then check that `~/.cache/herdr-claude-usage.json` exists with `jq '.rate_limits'`.

- [ ] **Step 4: Run `herdr-app shot` on the scratchpad file and view it.** Expected: the card sits between the agents list and Settings, with both rows filled. Collapse the sidebar (`ctrl-shift-b` or `layout.resize sidebar 76`), shoot again and confirm the rail numbers, then restore the width.

- [ ] **Step 5: Write `README.md`.** Cover what the card does, install (symlink, clone layout, settings change) and uninstall (`layout.switch main`, delete `layouts/main-usage.json` and the symlink, restore `statusLine.command` to `ccstatusline`). Also add a short note to `~/.config/herdr-app/AGENTS.local.md` pointing at this repo.

- [ ] **Step 6: Commit** `docs: claude-usage install notes`
