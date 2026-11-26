# Claude usage mod Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Feed the Herdr usage card from a Claude Code mod instead of the status line tap.

**Architecture:** A hooks module on `session.measure` merges the rate-limit windows into the JSON file the Herdr card reads. Pure merge logic in its own file.

**Tech Stack:** Claude Code 2.1.332 function-hook plugins (TypeScript), `claude plugin test`, `claude plugin validate`.

**Spec:** docs/superpowers/specs/2026-11-26-claude-usage-sidebar-design.md (last update section)

## Global Constraints

- File format and path unchanged (`HERDR_CLAUDE_USAGE_FILE`, default `$HOME/.cache/herdr-claude-usage.json`); `resets_at` written as epoch seconds.
- Only `five_hour` and `seven_day` are saved.
- The hook always calls `next(e)`; read/write failures are logged with `$.ui.log`, never thrown.

## Review Focus

- A saved file from the old tap (epoch-second `resets_at`) merges correctly with ISO `resetsAt` from the engine.
- A corrupt saved file is replaced, not a blocker.
- Unchanged figures don't rewrite the file (no `updated_at` bump).
- `changed` without `rateLimits` writes nothing.
- Empty `rateLimits` (off a subscription) writes nothing.

### Task 1: merge logic + hook

**Files:** Create `claude-usage/claude-code-mod/.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`, `hooks/merge.ts`, `hooks/register.test.ts`; `.claude-plugin/marketplace.json` at repo root.

- `merge(saved: unknown, limits: SessionRateLimit[], nowS: number): SavedFile | null` — null when nothing to write.
- Tests (via `claude plugin test`, raising `$.session.measure`): writes both windows; old-tap epoch file + newer ISO reset wins; same reset higher usage wins; older snapshot loses; window missing from input keeps saved; corrupt file replaced; unchanged → no write; no `rateLimits` in `changed` → no write; empty list → no write.
- Verify: `claude plugin validate`, `claude plugin test claude-usage/claude-code-mod` all pass.

### Task 2: switch over

- Remove `statusline-tap.sh`, `test/tap.test.sh`; README install/uninstall/how-it-works updated; `statusLine.command` back to `ccstatusline`; install the plugin from the local marketplace; check the card still updates.
