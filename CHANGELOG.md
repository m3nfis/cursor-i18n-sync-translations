# Changelog

All notable changes to the **i18n Sync Translations** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.1] - 2026-04-29

### Added

- **Cursor Agent Skill — `i18n-sync-setup`** *(new `cursor-skill/` folder, optional install)*. A one-shot installer/configurator for the extension that pins `i18nSync.model` to `gemini-3-flash` and seeds sensible defaults. The skill auto-triggers on phrases like *"install i18n sync"* / *"set up i18n translations"* and walks the agent through locating the latest `.vsix`, installing it via `agent --install-extension`, patching the user's Cursor `settings.json` (read-modify-write — preserves unrelated keys), and optionally seeding `productContext` per-workspace. Ships with `cursor-skill/install.sh` that lets the user pick **global** (`~/.cursor/skills/`) or **workspace** (`./.cursor/skills/`) install scope.
- **Sync-time model warning.** `i18n: Sync Translations` now logs a single `WARNING:` line in the output channel at sync start when `i18nSync.model` is anything other than `gemini-3-flash`. Soft enforcement only — the sync still runs — but the warning makes a quietly-changed model setting impossible to miss. The skill is the install-time fix; this is the runtime backstop.

## [1.5.0] - 2026-04-29

### Added

- **`i18nSync.productContext` setting** *(workspace-scoped)* — an optional, free-text product/domain description that is prepended to every translation prompt. Helps the model pick domain-appropriate terminology for ambiguous words like *capture*, *settle*, *pay*, *statement*, *receivable* — where the right translation depends entirely on the product. Empty by default (no behaviour change for existing users); opt in per project via `.vscode/settings.json`.
  - Concrete examples that materially change output quality: a payments app gets *Belasten* for "Capture" instead of literal *Aufnehmen*; a hotel app keeps refund/cancellation language in legal register instead of casual; a healthcare app uses HIPAA-aware patient/provider vocabulary.
  - Injected directly under the target-language line (top of the prompt where instruction-following is strongest), above the rules block. No effect on the existing `translationTone` setting — they compose: `tone + domain` is the prompt header pair.
  - Sync header logs the configured length and warns when >800 chars (every batch carries the overhead — keeps users from pasting marketing brochures).
  - Test-app ships a representative `productContext` in `test-app/.vscode/settings.json` so the end-to-end harness exercises the new path immediately. Override / disable via `I18N_SYNC_TEST_PRODUCT_CONTEXT` env var for A/B comparisons against the no-context baseline.

## [1.4.0] - 2026-04-29

### Added

- **Robust Cursor CLI detection.** `cursorCliPath: auto` no longer relies solely on `PATH`. After probing `agent` and `cursor` on `PATH`, the extension now walks a list of known install locations — `~/.cursor/cli/`, `~/.local/bin/`, `/opt/homebrew/bin/`, `/usr/local/bin/`, `/Applications/Cursor.app/Contents/Resources/app/bin/`, plus the equivalents on Linux and Windows — and uses any `agent`/`cursor` binary it finds. Fixes the macOS GUI-launch gotcha where `which agent` works in the user's shell but the Extension Host (which inherits a minimal launchd PATH) cannot see it.
- **`i18n: Detect Cursor CLI` command.** New command-palette entry that re-runs the resolution from scratch and prints a full diagnostic report to the output channel: configured path, every probe attempt with its error code, the effective PATH (one entry per line), every fallback location checked, and the final resolved binary. If the CLI is found at an absolute path (i.e. not on the Extension Host's PATH), the user is offered a one-click "Save Path" action that persists it into `i18nSync.cursorCliPath` so future runs skip the search.
- **Pre-flight check before every sync.** `i18n: Sync Translations` now resolves the CLI *before* it builds any batches. On failure, the user gets a single actionable popup ("Detect CLI / Open Settings / View Output") plus a structured report in the output channel — instead of N batches × `maxRetries` identical `spawn agent ENOENT` lines.

### Changed

- **No retries on `cli_missing`.** Spawn-time `ENOENT` is now classified as `cli_missing` and short-circuits the retry loop (retrying with the same PATH won't change the outcome). The CLI resolution cache is invalidated automatically so the next sync re-probes (e.g. after the user installs the CLI mid-session).
- **Auto-sync respects the new pre-flight.** Background auto-sync also bails out early when the CLI is unreachable, but stays silent (no popups) — it just logs once to the output channel and waits for the next tick. This keeps the foreground sync as the only place the user gets prompted.

## [1.3.2] - 2026-04-29

### Changed

- **Default `cliTimeoutSeconds` raised from `90` → `180`.** Direct CLI benchmarks (single call with the same prompt the extension sends) showed Cursor CLI / Gemini backend latency frequently in the 60-80 s range and occasionally exceeding 90 s, even for tiny one-key prompts. The 90 s default was killing healthy-but-slow batches and forcing a retry that often took another 40-50 s — net cost ~130 s. Bumping the timeout to 180 s lets the slow-but-alive case complete on the first attempt. Users on consistently fast networks can still drop it back via settings.
- **Default `concurrentLimit` raised from `2` → `3`.** Per-call backend latency dominates wall time, so adding a third in-flight batch lets one more language wait *in parallel* instead of serially. Rate-limit / quota detection is unchanged, so users who actually hit limits will still see clear errors and can drop concurrency back.
- **No backoff on CLI timeout or `bad_response` retries.** The 2-8 s exponential backoff between retries was originally added for rate-limited responses, where slowing down genuinely helps. For a CLI timeout the batch already burned `cliTimeoutSeconds` of wall time waiting on the backend; sleeping another 2 s before retrying is pure dead time. Backoff now only triggers for `rate_limit` and `retryable_error` failure types. The retry log line now states the reason (`Backing off Ns before retry (reason: rate_limit)...` vs `Retrying immediately (reason: timeout, no backoff needed)...`).
- **Internal: dedicated `timeout` error type.** CLI timeouts are now classified separately from generic `error` so the retry policy can be cleanly differentiated without string-matching the message.

### Added

- **More CLI latency diagnostics in debug mode.** Batch logs now include prompt stats (`chars`, `lines`, `contextLines`, `items`, `maxInputValueChars`), process environment context (`cwd`, `PATH` entry count), first-stdout / first-stderr latency, last-output age, and a 30 s slow-start warning when the Cursor CLI is alive but has produced no output. This makes it easier to distinguish prompt-size issues from Cursor CLI / model queue stalls.

## [1.3.1] - 2026-04-29

### Changed

- **Stop sending translation keys on the to-translate line.** Previously each item was sent as `N. key: "value"`, which Gemini-family models would occasionally mirror back as `N. key: "translation"` instead of just `N. translation`. The numbered items are now sent as `N. "value"` only — the parent prefix is still present in the section header (`# --- Section: settings.agreements ---`), so semantic context is preserved, but the model no longer has a `key:` token in its input to echo. Eliminates the most common source of "echoed key" responses observed in v1.3.0 logs.
- **`sanitizeTranslatedValue` now always unwraps surrounding quotes** (defensively), in addition to the existing key-echo strip. Models that mirror the prompt's quoted format back as `1. "translation"` no longer leak literal quote characters into the saved file. The key-echo strip is retained as defence-in-depth.
- **Tighter prompt format rule.** Replaced the ambiguous `Return ONLY the translated values in the exact same numbered format: "N. translated value"` with explicit no-quotes / no-key guidance and a worked example, reducing the chance of models over-mirroring the input format.

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
