# i18n Sync Test App

Small Vite + React hotel-booking demo used as a regression fixture for the
i18n sync extension. The locale files in `src/locales/` are the
**source of truth**: tests delete keys from them, re-translate via the
extension, then compare the AI output against the original.

## Run the demo app

```bash
npm install
npm run dev
```

## Locale files

| File                          | Notes                                |
|-------------------------------|--------------------------------------|
| `src/locales/i18n-en.json`    | Source of truth (16 strings)         |
| `src/locales/i18n-es.json`    | Spanish                              |
| `src/locales/i18n-fr.json`    | French                               |
| `src/locales/i18n-zh.json`    | Chinese (Simplified)                 |

The strings deliberately exercise everything the extension has to handle:
HTML tags (`<strong>`, `<em>`), `{placeholders}` including escaped quotes
(`+"{fee}"`), straight ASCII quotes around brand names, long legal-style
prose, and short UI labels.

## Test commands

| Command                | What it does                                                                              |
|------------------------|-------------------------------------------------------------------------------------------|
| `npm run i18n:generate`| Regenerates `es/fr/zh` from a static catalog inside the script. Lossless reset.           |
| `npm run i18n:validate`| Asserts key parity + that every `{placeholder}` and HTML tag in EN appears in each lang.  |
| `npm run i18n:test`    | `generate` then `validate`. One-shot fixture regression.                                  |
| `npm run i18n:e2e`     | Runs the **real, compiled extension** end-to-end against this directory. See below.       |

## End-to-end extension test (`npm run i18n:e2e`)

This is the production-quality regression test for the extension itself.

**Prerequisites**

- Extension compiled: from the repo root, run `npm install && npm run compile`.
- `cursor` CLI on `PATH` (verify with `cursor --version`).
- ~50 seconds of wall time (3 batches × ~17 s on `gemini-3-flash`).

**What it does**

1. Snapshots the current locale files.
2. Deletes 5 keys per language (different keys per language to exercise variety).
3. Drives `out/translationEngine.js`, `out/syncUtils.js`,
   `out/fileHandlers.js`, `out/contextInference.js`, and
   `out/localeUtils.js` via a thin `vscode` stub — exactly the code path
   that runs when a user clicks *Sync Translations* in Cursor.
4. Validates structural integrity (key parity, placeholders, HTML tags).
5. Scores each rewritten key against the source-of-truth:
   - `EXACT` — byte-identical match
   - `LENIENT` — case- and whitespace-insensitive match
   - `DIFFERENT` — diff printed for inspection
6. Restores the source-of-truth files in a `finally` block. The working
   tree is unchanged after the run.

**Exit code**

- `0` — structural validation passed and no batch failed.
- `1` — anything else (failed batch or structural mismatch).
- `2` — harness setup failure (e.g. extension not compiled).

**About the score**

`DIFFERENT` does not mean "broken". AI translations are not deterministic
strings; expect synonyms, better idiomatic phrasing, and more
typographically-correct punctuation (e.g. French `« »`, Chinese
full-width `（）`). The structural validation is the hard pass/fail
criterion.

**Sample output (16 keys total, 5 removed × 3 languages = 15 retranslated)**

```
=== i18n-sync-extension end-to-end test ===
Locale dir:   /…/test-app/src/locales
Model:        gemini-3-flash
Tone:         formal business
Context:      5 sibling keys

Step 1 — Removed keys to simulate missing translations
  es: ctaButton, roomSummary, breakfastToggle, roomOptions, cancellationTerms
  fr: guestLabel, trustNote, footerHelp, legalDisclaimer, cancellationTerms
  zh: heroSubtitle, checkOutLabel, breakfastToggle, roomOptions, legalDisclaimer

Step 2 — findMissingKeys
  Total missing: 15
  es: 5 missing
  fr: 5 missing
  zh: 5 missing

Step 3 — Translate (real cursor CLI calls)
  [Batch 1 | ES] 5 keys...  OK  (17.3s)
  [Batch 2 | FR] 5 keys...  OK  (15.2s)
  [Batch 3 | ZH] 5 keys...  OK  (18.2s)
  Total: 3 ok, 0 fail, 50.8s wall.

Step 4 — Merge translations into files
  es: merged 5 new key(s) into i18n-es.json
  fr: merged 5 new key(s) into i18n-fr.json
  zh: merged 5 new key(s) into i18n-zh.json

Step 5 — Structural validation
  PASS Translation validation passed for es/fr/zh.

Step 6 — Per-key score vs source-of-truth
  Score: 5 exact / 0 lenient / 10 different (out of 15)

(Restored source-of-truth locale files.)
```
