#!/usr/bin/env bash
#
# statusline-tap.sh — Claude Code status line wrapper.
#
# Saves the `rate_limits` part of the status line JSON (5-hour and 7-day
# windows) to a file the Herdr `claude-usage` mod reads, then hands the exact
# same input to the real status line command and passes its output and exit
# code through. Saving is best effort: if it fails, the status line still works.
#
# Env:
#   HERDR_CLAUDE_USAGE_FILE  where to save (default ~/.cache/herdr-claude-usage.json)
#   CLAUDE_USAGE_NEXT        the status line command to run (default: ccstatusline)
#
# Deliberately no `set -e`: nothing here may stop the status line.

file="${HERDR_CLAUDE_USAGE_FILE:-$HOME/.cache/herdr-claude-usage.json}"
next="${CLAUDE_USAGE_NEXT:-ccstatusline}"

input="$(cat)"

# Every open session reports its own last snapshot, and Claude Code drops a
# window from it once that window resets. So merge into the saved file window
# by window instead of replacing it: a window with a later reset wins; within
# the same window the higher usage wins (usage only grows within a window).
# Prints the new file, or nothing when there is nothing new to save.
MERGE='
  def pick($o; $n):
    if $n == null then $o
    elif $o == null then $n
    elif $n.resets_at > $o.resets_at then $n
    elif $n.resets_at == $o.resets_at and ($n.used_percentage // 0) > ($o.used_percentage // 0) then $n
    else $o end;
  (.rate_limits // {}) as $new
  | if ($new | type) != "object" or $new == {} then empty else
      (($old[0].rate_limits // {}) as $prev
       | reduce ((($prev | keys) + ($new | keys)) | unique[]) as $k ({}; .[$k] = pick($prev[$k]; $new[$k]))
       | if . == $prev then empty else {updated_at: $now, rate_limits: .} end)
    end'

{
  dir="$(dirname "$file")"
  mkdir -p "$dir"
  # A corrupt saved file is treated as empty, so it gets replaced rather than blocking every write.
  if [ -s "$file" ] && jq -e . "$file" >/dev/null 2>&1; then old="$file"; else old=/dev/null; fi
  merged="$(printf '%s' "$input" | jq -c --slurpfile old "$old" --argjson now "$(date +%s)" "$MERGE")"
  if [ -n "$merged" ]; then
    tmp="$(mktemp "$dir/.herdr-claude-usage.XXXXXX")" &&
      printf '%s\n' "$merged" > "$tmp" &&
      mv -f "$tmp" "$file" || rm -f "$tmp"
  fi
} 2>/dev/null || true

printf '%s' "$input" | eval "$next"
