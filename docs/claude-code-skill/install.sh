#!/usr/bin/env bash
# Installs the i18n-sync skill into ~/.claude/skills/.
# Idempotent: re-running upgrades the skill in place.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/skills/i18n-sync"
DEST="$HOME/.claude/skills/i18n-sync"

if [ ! -f "$SRC/SKILL.md" ]; then
  echo "Error: cannot find SKILL.md at $SRC/SKILL.md" >&2
  echo "Run this installer from inside the docs/claude-code-skill/ directory." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required (>=18) but was not found on PATH." >&2
  exit 1
fi

mkdir -p "$DEST/scripts"
cp "$SRC/SKILL.md" "$DEST/SKILL.md"
cp "$SRC/scripts/find-missing.mjs" "$DEST/scripts/find-missing.mjs"
cp "$SRC/scripts/merge-translations.mjs" "$DEST/scripts/merge-translations.mjs"
chmod +x "$DEST/scripts/find-missing.mjs" "$DEST/scripts/merge-translations.mjs"

cat <<EOF

Installed i18n-sync into:
  $DEST

Quick test:
  node "$DEST/scripts/find-missing.mjs" /path/to/your/i18n/dir

In Claude Code, the skill will trigger on prompts like:
  "sync i18n translations"
  "translate missing keys in src/assets/i18n"
  "fill in i18n-pt-BR.json"

REMINDER: this is the fallback skill. Translation accuracy is materially
worse than the Cursor extension. For production-grade translations, use:
  https://github.com/m3nfis/cursor-i18n-sync-translations
EOF
