#!/usr/bin/env bash
# Tests for statusline-tap.sh. Run: bash claude-usage/test/tap.test.sh
set -u

TAP="$(cd "$(dirname "$0")/.." && pwd)/statusline-tap.sh"
failures=0

fail() { echo "FAIL: $1: $2" >&2; failures=$((failures + 1)); }

INPUT='{"rate_limits":{"five_hour":{"used_percentage":38,"resets_at":1795700000},"seven_day":{"used_percentage":82,"resets_at":1796000000}}}'

writes_rate_limits() {
  local dir out file now
  dir="$(mktemp -d)"; file="$dir/usage.json"
  out="$(printf '%s' "$INPUT" | HERDR_CLAUDE_USAGE_FILE="$file" CLAUDE_USAGE_NEXT=cat bash "$TAP")"
  [ "$out" = "$INPUT" ] || fail writes_rate_limits "stdout was '$out'"
  [ -f "$file" ] || { fail writes_rate_limits "no data file"; return; }
  [ "$(jq '.rate_limits.five_hour.used_percentage' "$file")" = 38 ] || fail writes_rate_limits "used_percentage not saved"
  now="$(date +%s)"
  jq -e --argjson now "$now" '(.updated_at | type) == "number" and ((.updated_at - $now) | fabs) <= 5' "$file" >/dev/null \
    || fail writes_rate_limits "updated_at missing or off: $(jq -c .updated_at "$file")"
}

keeps_file_without_rate_limits() {
  local dir file before out
  dir="$(mktemp -d)"; file="$dir/usage.json"
  before='{"updated_at":1,"rate_limits":{"five_hour":{"used_percentage":10}}}'
  printf '%s' "$before" > "$file"
  out="$(printf '%s' '{"model":{}}' | HERDR_CLAUDE_USAGE_FILE="$file" CLAUDE_USAGE_NEXT=cat bash "$TAP")"
  [ "$out" = '{"model":{}}' ] || fail keeps_file_without_rate_limits "stdout was '$out'"
  [ "$(cat "$file")" = "$before" ] || fail keeps_file_without_rate_limits "file changed to '$(cat "$file")'"
}

survives_unwritable_dir() {
  local out code
  out="$(printf '%s' "$INPUT" | HERDR_CLAUDE_USAGE_FILE=/nonexistent/x.json CLAUDE_USAGE_NEXT=cat bash "$TAP" 2>/dev/null)"; code=$?
  [ "$code" = 0 ] || fail survives_unwritable_dir "exit code $code"
  [ "$out" = "$INPUT" ] || fail survives_unwritable_dir "stdout was '$out'"
}

passes_exit_code() {
  local dir code
  dir="$(mktemp -d)"
  printf '%s' "$INPUT" | HERDR_CLAUDE_USAGE_FILE="$dir/usage.json" CLAUDE_USAGE_NEXT="sh -c 'cat >/dev/null; exit 3'" bash "$TAP" >/dev/null 2>&1; code=$?
  [ "$code" = 3 ] || fail passes_exit_code "exit code $code"
}

# Run the tap with $1 as input against an existing data file holding $2; print the file after.
run_against() {
  local dir file
  dir="$(mktemp -d)"; file="$dir/usage.json"
  [ -n "$2" ] && printf '%s' "$2" > "$file"
  printf '%s' "$1" | HERDR_CLAUDE_USAGE_FILE="$file" CLAUDE_USAGE_NEXT=cat bash "$TAP" >/dev/null
  cat "$file" 2>/dev/null
}

SAVED='{"updated_at":100,"rate_limits":{"five_hour":{"used_percentage":40,"resets_at":2000},"seven_day":{"used_percentage":20,"resets_at":9000}}}'

partial_rate_limits_keeps_other_window() {
  local after
  after="$(run_against '{"rate_limits":{"seven_day":{"used_percentage":25,"resets_at":9000}}}' "$SAVED")"
  [ "$(jq '.rate_limits.five_hour.used_percentage' <<<"$after")" = 40 ] || fail partial_rate_limits_keeps_other_window "five_hour lost: $after"
  [ "$(jq '.rate_limits.seven_day.used_percentage' <<<"$after")" = 25 ] || fail partial_rate_limits_keeps_other_window "seven_day not updated: $after"
}

empty_rate_limits_keeps_file() {
  local after
  after="$(run_against '{"rate_limits":{}}' "$SAVED")"
  [ "$after" = "$SAVED" ] || fail empty_rate_limits_keeps_file "file changed to $after"
}

older_snapshot_does_not_win() {
  local after
  # Same window, lower usage: an idle session's old snapshot.
  after="$(run_against '{"rate_limits":{"five_hour":{"used_percentage":5,"resets_at":2000}}}' "$SAVED")"
  [ "$after" = "$SAVED" ] || fail older_snapshot_does_not_win "stale snapshot overwrote: $after"
  # Earlier window entirely.
  after="$(run_against '{"rate_limits":{"five_hour":{"used_percentage":90,"resets_at":1000}}}' "$SAVED")"
  [ "$after" = "$SAVED" ] || fail older_snapshot_does_not_win "older window overwrote: $after"
}

newer_window_wins() {
  local after
  after="$(run_against '{"rate_limits":{"five_hour":{"used_percentage":2,"resets_at":20000}}}' "$SAVED")"
  [ "$(jq -c '.rate_limits.five_hour' <<<"$after")" = '{"used_percentage":2,"resets_at":20000}' ] || fail newer_window_wins "got $after"
  [ "$(jq '.updated_at' <<<"$after")" != 100 ] || fail newer_window_wins "updated_at not bumped"
}

unchanged_does_not_bump() {
  local after
  after="$(run_against '{"rate_limits":{"five_hour":{"used_percentage":40,"resets_at":2000}}}' "$SAVED")"
  [ "$after" = "$SAVED" ] || fail unchanged_does_not_bump "file rewritten: $after"
}

corrupt_file_is_replaced() {
  local after
  after="$(run_against "$INPUT" '{half a fi')"
  [ "$(jq '.rate_limits.five_hour.used_percentage' <<<"$after" 2>/dev/null)" = 38 ] || fail corrupt_file_is_replaced "got $after"
}

corrupt_file_is_replaced
writes_rate_limits
keeps_file_without_rate_limits
partial_rate_limits_keeps_other_window
empty_rate_limits_keeps_file
older_snapshot_does_not_win
newer_window_wins
unchanged_does_not_bump
survives_unwritable_dir
passes_exit_code

if [ "$failures" -gt 0 ]; then echo "$failures tap test(s) failed" >&2; exit 1; fi
echo "all tap tests passed"
