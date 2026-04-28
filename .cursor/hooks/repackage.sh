#!/usr/bin/env bash
# Cursor afterFileEdit hook.
# When a file under src/ or package.json is edited, schedule a debounced
# background re-package (npm run package). Never blocks the agent.
#
# Strategy:
#   - Read JSON from stdin, extract file_path.
#   - Bail out fast if the file is not in scope.
#   - Touch a "request" marker, spawn a detached worker that sleeps for
#     DEBOUNCE_MS, and only the latest worker actually packages.
#   - All output (stdout/stderr) goes to .cursor/hooks/last-package.log.

set -u

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK_DIR="$PROJECT_ROOT/.cursor/hooks"
LOG_FILE="$HOOK_DIR/last-package.log"
REQUEST_FILE="$HOOK_DIR/.repackage.request"
LOCK_DIR="$HOOK_DIR/.repackage.lock"
DEBOUNCE_MS="${I18N_SYNC_REPACKAGE_DEBOUNCE_MS:-1500}"

mkdir -p "$HOOK_DIR"

input="$(cat || true)"

# Always succeed; afterFileEdit cannot block edits anyway, but we still want
# to return clean JSON so Cursor logs stay tidy.
emit_ok() {
  echo '{}'
  exit 0
}

if ! command -v jq >/dev/null 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] jq missing; skipping repackage" >> "$LOG_FILE"
  emit_ok
fi

file_path="$(printf '%s' "$input" | jq -r '
  .tool_input.file_path
  // .tool_input.path
  // .file_path
  // .path
  // empty
')"

if [ -z "$file_path" ]; then
  emit_ok
fi

# Normalise to a path relative to PROJECT_ROOT.
case "$file_path" in
  "$PROJECT_ROOT"/*) rel="${file_path#"$PROJECT_ROOT"/}" ;;
  /*)                rel="$file_path" ;;
  *)                 rel="$file_path" ;;
esac

# Only re-package when something that ships in the .vsix actually changed.
in_scope=0
case "$rel" in
  src/*.ts|src/**/*.ts) in_scope=1 ;;
  package.json|tsconfig.json|.vscodeignore|README.md|CHANGELOG.md|LICENSE|icon.png) in_scope=1 ;;
  /*)
    # Absolute path that is not under PROJECT_ROOT — ignore.
    in_scope=0
    ;;
esac

# Glob fallback (case patterns above don't expand **) — match by suffix.
if [ "$in_scope" -eq 0 ]; then
  case "$rel" in
    *.ts) [[ "$rel" == src/* ]] && in_scope=1 ;;
  esac
fi

if [ "$in_scope" -eq 0 ]; then
  emit_ok
fi

# Mark this edit as the latest packaging request.
date +%s%N > "$REQUEST_FILE"
my_stamp="$(cat "$REQUEST_FILE")"

# Spawn detached worker; do NOT block the agent.
(
  sleep "$(awk "BEGIN { printf \"%.3f\", ${DEBOUNCE_MS}/1000 }")"

  # If a newer edit superseded us, bail out.
  current_stamp="$(cat "$REQUEST_FILE" 2>/dev/null || echo '')"
  if [ "$current_stamp" != "$my_stamp" ]; then
    exit 0
  fi

  # Single-flight: only one packager runs at a time. mkdir is atomic on
  # all POSIX-ish filesystems and avoids needing `flock` (missing on macOS).
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    exit 0
  fi
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

  cd "$PROJECT_ROOT" || exit 0

  {
    echo ""
    echo "============================================================"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Repackaging (trigger: $rel)"
    echo "============================================================"
    npm run package
    rc=$?
    if [ $rc -eq 0 ]; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] Repackage OK"
    else
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] Repackage FAILED (exit $rc)"
    fi
  } >> "$LOG_FILE" 2>&1
) </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true

emit_ok
