# Changelog

All notable changes to the **i18n Sync Translations** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
