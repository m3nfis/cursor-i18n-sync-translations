#!/usr/bin/env bash
# Installs the i18n-sync-setup Cursor skill either globally
# (~/.cursor/skills/) or scoped to the current workspace
# (./.cursor/skills/).
#
# Usage:
#   ./install.sh                 # interactive picker
#   ./install.sh global          # non-interactive: install to ~/.cursor/skills/
#   ./install.sh workspace [dir] # non-interactive: install to <dir>/.cursor/skills/
#                                # (defaults to current directory)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="i18n-sync-setup"
SKILL_SRC="${SCRIPT_DIR}/${SKILL_NAME}"

if [[ ! -d "${SKILL_SRC}" ]]; then
  echo "Error: skill source not found at ${SKILL_SRC}" >&2
  exit 1
fi

mode="${1:-}"

if [[ -z "${mode}" ]]; then
  echo "Where should the i18n-sync-setup skill be installed?"
  echo "  1) Global   (~/.cursor/skills/) — available in every workspace"
  echo "  2) Workspace (./.cursor/skills/) — committed to this repo, shared with the team"
  read -rp "Choose [1/2]: " choice
  case "${choice}" in
    1) mode="global" ;;
    2) mode="workspace" ;;
    *) echo "Invalid choice: ${choice}" >&2; exit 1 ;;
  esac
fi

case "${mode}" in
  global)
    target_root="${HOME}/.cursor/skills"
    ;;
  workspace)
    workspace_dir="${2:-$(pwd)}"
    if [[ ! -d "${workspace_dir}" ]]; then
      echo "Error: workspace dir not found: ${workspace_dir}" >&2
      exit 1
    fi
    target_root="${workspace_dir}/.cursor/skills"
    ;;
  *)
    echo "Unknown mode: ${mode}" >&2
    echo "Expected 'global' or 'workspace'." >&2
    exit 1
    ;;
esac

target="${target_root}/${SKILL_NAME}"

mkdir -p "${target_root}"

if [[ -e "${target}" ]]; then
  echo "Skill already installed at ${target}"
  read -rp "Overwrite? [y/N]: " ow
  if [[ ! "${ow}" =~ ^[yY]$ ]]; then
    echo "Aborted. No changes made."
    exit 0
  fi
  rm -rf "${target}"
fi

cp -R "${SKILL_SRC}" "${target}"

echo
echo "✓ Installed i18n-sync-setup skill at:"
echo "    ${target}"
echo
echo "The skill auto-triggers on phrases like:"
echo "  • 'install i18n sync'"
echo "  • 'set up i18n translations'"
echo "  • 'configure the i18n sync extension'"
echo
echo "Open Cursor and try one of those in the agent chat to install + configure"
echo "the extension with gemini-3-flash pinned as the model."
