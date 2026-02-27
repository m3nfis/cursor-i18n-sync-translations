# i18n Sync Translations

A  Cursor extension that automatically detects missing i18n translation keys and syncs them across all language files using the Cursor CLI.

## Features

- **Context-aware translations** - Extracts adjacent sibling keys (same prefix group) to give the LLM domain context, producing more accurate and consistent translations.
- **YAML-structured prompts** - Batches are sent as YAML sections with commented context so the LLM sees the semantic grouping of keys.
- **Configurable LLM model** - Choose which model to use (Gemini, Claude, GPT, Grok, etc.).
- **Auto-detect missing keys** - Compares all language files against the English base file.
- **Batch translation** - Uses the Cursor CLI agent to translate in efficient batches.
- **Resumable** - If interrupted, progress is saved and can be resumed.
- **Dual format support** - Works with both JSON (`i18n-en.json`) and Java Properties (`Messages.properties`).
- **Background auto-sync** - Optional file watcher that silently translates new keys on a debounced timer.
- **Context menu integration** - Right-click on `i18n-en.json` in the explorer to sync.
- **Editor title button** - Globe icon appears when editing i18n files.
- **Status bar indicator** - Shows sync status when i18n files are open.
- **Progress notifications** - Real-time progress with cancellation support.

## Installation

### From the VS Code Marketplace

1. Open VS Code or Cursor.
2. Go to the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Search for **i18n Sync Translations**.
4. Click **Install**.

### From a VSIX package

```bash
# Build locally
npm install
npm run compile
npm run package

# Install the resulting .vsix file
cursor --install-extension i18n-sync-translations-1.0.0.vsix
# Or: Cmd+Shift+P > "Extensions: Install from VSIX..."
```

## How to Use

### From the File Explorer (right-click)

1. Right-click on `i18n-en.json` (or `Messages.properties`).
2. Select **"Sync Translations"**.

### From the Editor Title Bar

1. Open `i18n-en.json` in the editor.
2. Click the globe icon in the editor title bar.

### From the Command Palette

1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux).
2. Type "i18n" and select:
   - **i18n: Sync Translations** - Full sync
   - **i18n: Check Missing Translations** - Preview what's missing

### From the Status Bar

When an i18n file is open, click the **i18n Sync** item in the status bar.

## Supported Project Structures

### JSON Format

```
src/assets/i18n/
  i18n-en.json       (base - English)
  i18n-de.json       (German)
  i18n-es.json       (Spanish)
  i18n-fr.json       (French)
  ...
```

### Java Properties Format

```
src/main/resources/i18n/
  Messages.properties       (base - English)
  Messages_de.properties    (German)
  Messages_es.properties    (Spanish)
  ...
```

## Configuration

Open Settings (`Cmd+,` / `Ctrl+,`) and search for **"i18n Sync"**:

| Setting | Default | Description |
|---------|---------|-------------|
| `i18nSync.model` | `gemini-3-flash` | LLM model for translations. **Gemini 3 Flash is strongly recommended** - best multilingual data, fast, cheap. |
| `i18nSync.contextWindowSize` | `5` | Number of adjacent sibling keys to include as context (0 to disable). |
| `i18nSync.batchSize` | `40` | Keys per translation batch. |
| `i18nSync.concurrentLimit` | `2` | Concurrent batch limit. |
| `i18nSync.maxRetries` | `3` | Retry attempts per batch. |
| `i18nSync.translationTone` | `formal business` | Translation tone/style. |
| `i18nSync.autoSync` | `false` | Background auto-sync: watches the EN file and translates silently on a timer. |
| `i18nSync.autoSyncIntervalMinutes` | `3` | Minutes to wait after a file change before auto-syncing (1-30). |
| `i18nSync.cursorCliPath` | `cursor` | Path to Cursor CLI. |
| `i18nSync.debugMode` | `false` | Verbose logging. |

### Background Auto-Sync

Enable `i18nSync.autoSync` to have the extension watch `i18n-en.json` (or `Messages.properties`) in the background. When you save the file, a timer starts (default 3 minutes). After the timer fires, the extension silently detects missing keys and translates them - no prompts, no popups, no interruptions.

- The timer **resets on each save**, so rapid edits are debounced into a single sync.
- Status bar shows `$(sync~spin) i18n Auto-Syncing...` while running, then briefly flashes the result.
- All activity is logged to the "i18n Sync Translations" output channel.
- If a sync is already running when the timer fires, it skips.

### Context Inference

When translating a key like `settings.agreements.select_file`, the extension looks at adjacent keys with the same prefix (`settings.agreements.*`) that already exist in the target language file. These are included as YAML comments in the prompt so the LLM understands the domain:

```yaml
# --- Section: settings.agreements ---
# Context (already translated siblings for reference, DO NOT translate these):
#   settings.agreements.title: Vereinbarung & Unterschrift
#   settings.agreements.enabled: Aktiviert
#   settings.agreements.disabled: Deaktiviert
#   ...
#   settings.agreements.replace: Ersetzen
#   settings.agreements.download_document: Dokument herunterladen
#
# Translate the following:
1. settings.agreements.select_file: "Select file"
2. settings.agreements.uploading: "Uploading file..."
```

This produces translations that are consistent with the existing terminology in each language file.

## Prerequisites

- **Cursor IDE** with the CLI available in your PATH
  - In Cursor: `Cmd+Shift+P` > "Install 'cursor' command in PATH"
- Node.js (for building from source)

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (auto-recompile on changes)
npm run watch

# Debug: Press F5 in Cursor/VS Code to launch Extension Development Host
```

## Architecture

```
src/
  extension.ts          # VS Code extension entry point, commands, UI
  autoSync.ts           # Background file watcher and auto-sync logic
  translationEngine.ts  # Cursor CLI integration, batching, retries
  contextInference.ts   # Adjacent key extraction, YAML prompt builder
  fileHandlers.ts       # JSON and .properties file I/O, project config detection
  stateManager.ts       # Resumable state persistence
  syncUtils.ts          # Shared utilities (missing-key detection, merge logic)
```

## Publishing to the VS Code Marketplace

1. Create a publisher account at [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage/createpublisher).
2. Update the `publisher` field in `package.json` with your publisher ID.
3. Add a 128x128 `icon.png` to the project root.
4. Optionally add a `repository` field in `package.json` pointing to your public repo.
5. Run:

```bash
npx @vscode/vsce publish
```

## License

[MIT](LICENSE)
