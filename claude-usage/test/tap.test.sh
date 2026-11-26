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

writes_rate_limits
keeps_file_without_rate_limits
survives_unwritable_dir
passes_exit_code

if [ "$failures" -gt 0 ]; then echo "$failures tap test(s) failed" >&2; exit 1; fi
echo "all tap tests passed"
