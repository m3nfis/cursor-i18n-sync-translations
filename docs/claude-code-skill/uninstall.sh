#!/usr/bin/env bash
# Removes the i18n-sync skill from ~/.claude/skills/.

set -euo pipefail

DEST="$HOME/.claude/skills/i18n-sync"

if [ ! -d "$DEST" ]; then
  echo "Nothing to remove — $DEST does not exist."
  exit 0
fi

rm -rf "$DEST"
echo "Removed $DEST"
