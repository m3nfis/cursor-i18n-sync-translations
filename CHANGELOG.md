# Changelog

All notable changes to the **i18n Sync Translations** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-04-29

### Added

- **Dual CLI support (`agent` + legacy `cursor`)** - Cursor renamed the CLI binary from `cursor` to `agent` in 2026. The extension now auto-detects which is installed: it probes `agent --version` first, falls back to `cursor --version`, and adjusts its argument layout accordingly (the new `agent` binary is invoked directly without the `agent` subcommand; the legacy `cursor` binary still uses `cursor agent ...`). Detection is cached per session and re-run when the user changes the setting.
- **`i18nSync.cursorCliPath` accepts `auto`** *(new default)* - explicit values `agent`, `cursor`, or an absolute path still work; the basename of a custom path is used to decide whether to prepend the `agent` subcommand. Existing users with an explicit `cursor` setting continue to work unchanged.
- **Live verbose logging for stuck syncs.** Enabling `i18nSync.debugMode` now additionally streams `stdout`/`stderr` chunks **as they arrive** from the CLI, prints the resolved command + child PID, and emits a heartbeat every 15 s while a batch is in flight (`[Batch 1 | DE] still running after 30s (stdout=0b, stderr=0b, pid=12345)`). Makes it trivial to tell whether the CLI is producing any output at all vs. hanging on auth/network.
- **Always-on timeout diagnostics.** Even with debug mode off, partial `stdout`/`stderr` is dumped to the output channel on every CLI timeout, plus a hint pointing at the most likely cause (auth / network) when both streams are empty. Previously the user only saw `Command timeout after 90 seconds` with no further context.
- **`i18nSync.cliTimeoutSeconds` setting** (default `90`, range `10`–`600`) so users on slow networks / with large batches can bump the per-batch CLI timeout without rebuilding the extension.

## [1.1.0] - 2026-04-28

### Added

- **BCP 47 long locale support** - the file matcher now accepts language + region/script subtags, including numeric M.49 region codes. Recognised filename forms include `i18n-en-GB.json`, `i18n-pt-BR.json`, `i18n-fr-CA.json`, `i18n-fr-FR.json`, `i18n-es-ES.json`, `i18n-es-419.json`, `i18n-zh-Hans.json`, `i18n-zh-Hant.json`, plus brand-new short locales such as `i18n-pl.json`. Same scheme works for Java Properties (`Messages_pt-BR.properties` etc.).
- **Human-readable target language in prompts** - the LLM now receives `Translate the English strings below to Brazilian Portuguese (pt-BR)` instead of the raw locale code, which materially improves output quality for regional variants and script subtags. Resolution uses `Intl.DisplayNames`.
- **Short-locale fallback for context** - when translating into a long locale whose file does not yet exist (e.g. first-ever sync of `pt-BR`), the existing short-locale file (`pt`) is loaded as context so the model produces translations consistent with the language's established tone and vocabulary. Logged as `Using PT as context fallback (no existing pt-BR file)`.
- **End-to-end test harness** - `test-app/` contains a Vite + React fixture whose locale files are the source of truth; `npm run i18n:e2e` from inside it deletes a controlled subset of keys, drives the real compiled extension code (with `vscode` stubbed) through the actual Cursor CLI + `gemini-3-flash`, validates structural integrity, scores per-key against the truth, and restores files in `finally`. Provides a single-command regression check before releases or prompt changes.

## [1.0.1] - 2026-04-28

### Fixed

- **Echoed key prefix in translations** - the parser now strips a mirrored `key: "value"` payload that some models (notably Gemini variants) occasionally return instead of the bare translated value. Previously this leaked the key back into the stored value (e.g. `"upload.file.limit.error": "upload.file.limit.error: \"Es kann nur eine Datei hochgeladen werden.\""`). Surrounding quotes and `\"` / `\\` escapes are also unwrapped when an echo is detected; legitimate values that start or end with quote characters are left untouched.

## [1.0.0] - 2025-01-01

### Added

- **Context-aware translations** - adjacent sibling keys (same prefix group) are included as context so the LLM produces domain-consistent translations.
- **Dual format support** - JSON (`i18n-en.json`) and Java Properties (`Messages.properties`).
- **Batch translation** via the Cursor CLI with configurable batch size and concurrency.
- **Resumable sync** - interrupted sessions save progress to a temp file and can be resumed.
- **Background auto-sync** - optional file watcher that silently translates new keys on a debounced timer.
- **Configurable LLM model** - choose from Gemini, Claude, GPT, Grok, and more.
- **Context menu, editor title, command palette, and status bar** integration.
- **Check Missing Translations** command for a quick preview without syncing.
