#!/usr/bin/env bash
# Copies the mod into Herdr's mods folder. Herdr hot-reloads files saved inside
# that folder, but not edits made through a symlink, so run this after each edit.
set -euo pipefail
src="$(cd "$(dirname "$0")/mod" && pwd)"
dest="$HOME/.config/herdr-app/mods/repo-link"
[ -L "$dest" ] && rm "$dest"
mkdir -p "$dest"
cp "$src/mod.json" "$src/main.js" "$src/repo.js" "$src/github.svg" "$src/gitlab.svg" "$dest/"
herdr-app check "$dest"
