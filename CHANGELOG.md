# Changelog

All notable changes to the **i18n Sync Translations** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
