# Cursor Agent Skill — i18n Sync Setup

A [Cursor Agent Skill](https://cursor.com/docs/agent/skills) that installs the `i18n-sync-translations` extension and writes a verified-good Cursor settings block, with `i18nSync.model` pinned to `gemini-3-flash` (the only model with strong enough multilingual training data for production translations).

## What it does

When a Cursor user types something like *"install i18n sync"* or *"set up i18n translations"*, the agent loads this skill and:

1. Locates the latest `.vsix` (in this repo's `releases/` folder, or via `gh release`).
2. Installs it with `agent --install-extension`.
3. Patches the user's Cursor `settings.json` with the recommended config block — pinning `i18nSync.model = "gemini-3-flash"` and only filling in other keys that aren't already set.
4. Optionally inspects the open workspace and proposes a `productContext` value (workspace-scoped).
5. Verifies the install and prints a 4-line summary.

## Install

```bash
./install.sh
```

Pick **global** (`~/.cursor/skills/`, available in every workspace) or **workspace** (`./.cursor/skills/`, committed to the current repo and shared with the team) at the prompt.

Non-interactive equivalents:

```bash
./install.sh global
./install.sh workspace                 # install to current dir
./install.sh workspace /path/to/repo   # install to a specific repo
```

After install, open the Cursor agent chat and try:

> install i18n sync

The agent will pick up the skill from its description and walk through the install + config flow.

## Uninstall

```bash
# Global
rm -rf ~/.cursor/skills/i18n-sync-setup

# Workspace
rm -rf ./.cursor/skills/i18n-sync-setup
```

## Notes

- The skill **only** pins `i18nSync.model`. Other keys (`batchSize`, `concurrentLimit`, `productContext`, etc.) are filled in only if not already present — the user's other choices are preserved.
- Sync-time enforcement (warning if model isn't `gemini-3-flash`) lives **in the extension itself**, not in this skill. The skill is a one-shot installer; the warning is the runtime backstop.
- This skill is a Cursor Agent Skill (`~/.cursor/skills/` or `.cursor/skills/`). It is **not** a Claude Code skill — those live elsewhere and use a slightly different format.
