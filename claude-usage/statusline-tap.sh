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

{
  limits="$(printf '%s' "$input" | jq -c '.rate_limits // null')"
  if [ -n "$limits" ] && [ "$limits" != null ]; then
    dir="$(dirname "$file")"
    mkdir -p "$dir"
    tmp="$(mktemp "$dir/.herdr-claude-usage.XXXXXX")" &&
      jq -n --argjson limits "$limits" --argjson now "$(date +%s)" \
        '{updated_at: $now, rate_limits: $limits}' > "$tmp" &&
      mv -f "$tmp" "$file" || rm -f "$tmp"
  fi
} 2>/dev/null || true

printf '%s' "$input" | eval "$next"
