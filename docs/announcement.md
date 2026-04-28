# Slack Announcement

Paste-ready text for `#frontend` / `#engineering` / wherever fits. Slack mrkdwn (single `*` for bold, single `_` for italic).

---

*New tool: i18n Sync Translations* — a Cursor/VS Code extension that auto-translates missing i18n keys for you. Stop hand-editing `i18n-de.json`.

*What it does*
• Detects keys present in `i18n-en.json` but missing from any other language file.
• Translates only what's missing — never overwrites existing values.
• Works on JSON (`i18n-en.json`) and Java Properties (`Messages.properties`).
• Long locales (BCP 47) supported: `i18n-pt-BR.json`, `i18n-fr-CA.json`, `i18n-es-419.json`, `i18n-zh-Hans.json`, `i18n-en-GB.json`, etc. Falls back to the short-locale file for context on first sync.
• Resumable — if a sync gets interrupted (quota, network, you closed Cursor), reopen and pick "Resume".
• Optional background auto-sync on save.

*Install (2 minutes)*
1. Download `i18n-sync-translations-1.1.0.vsix` from the GitHub release.
2. In Cursor: `Cmd+Shift+P` → *Extensions: Install from VSIX…* → pick the file.
3. Open settings → search `i18nSync.model` → set it to *`gemini-3-flash`*.

Full guide with screenshots and troubleshooting:
<INSTALL_GUIDE_URL>

*Important — please read*
Use *`gemini-3-flash`* as the model. Always. It's the strongest model for translations (best multilingual training data), the fastest, and the cheapest. The other options (Claude / GPT / Composer / Grok) are noticeably weaker on non-English languages and will burn quota for worse output. The default is already `gemini-3-flash`, but double-check after install.

*How to use*
Right-click `i18n-en.json` in the file explorer → *Sync Translations*. Done.

*Using Claude Code instead of Cursor?*
There's a fallback Claude Code skill at `docs/claude-code-skill/` in the same repo. *Translation quality is materially worse* (no Gemini), so use it only if Cursor is genuinely not an option for you. Install with `./install.sh` from that folder. Native-speaker review of the output is mandatory before shipping.

Source + issues: <https://github.com/m3nfis/cursor-i18n-sync-translations>

---

## Shorter variant (one-paragraph version)

*New tool — i18n Sync Translations* (Cursor extension). Detects missing keys in your i18n files and translates them in batches via the Cursor CLI. Supports JSON, Java Properties, and BCP 47 long locales (`pt-BR`, `es-419`, `zh-Hans`, etc.). Install: download `i18n-sync-translations-1.1.0.vsix`, then `Cmd+Shift+P` → *Extensions: Install from VSIX…*. *Set the model to `gemini-3-flash`* in settings — it's the only one that does translations well. Full guide: <INSTALL_GUIDE_URL>. Source: <https://github.com/m3nfis/cursor-i18n-sync-translations>.
