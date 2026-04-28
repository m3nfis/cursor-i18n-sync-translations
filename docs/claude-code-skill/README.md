# i18n Sync — Claude Code skill (fallback)

> # ⚠ STOP — READ BEFORE INSTALLING ⚠
>
> **This skill is a fallback for developers who cannot use Cursor.**
>
> The translations it produces are **measurably worse** than the
> [Cursor extension](https://github.com/m3nfis/cursor-i18n-sync-translations),
> which uses **Gemini 3 Flash** — the strongest current production model for
> multilingual work.
>
> If you have Cursor available, **install the extension instead** and stop
> reading this README:
>
> 1. Download `i18n-sync-translations-1.1.0.vsix` from the
>    [GitHub release](https://github.com/m3nfis/cursor-i18n-sync-translations/releases).
> 2. In Cursor: `Cmd+Shift+P` → *Extensions: Install from VSIX…* → pick the file.
> 3. Settings → set `i18nSync.model` to `gemini-3-flash`.
>
> This Claude Code skill exists only because some teammates work in Claude Code
> and don't have the Cursor option. Continue at your own risk.

---

## Why is this worse?

The Cursor extension calls out to the Cursor CLI (`cursor agent --print`)
and lets you pick `gemini-3-flash` as the model. Gemini 3 Flash:

- Has the broadest, most up-to-date multilingual training data of any
  current production model (Google's translation corpus is unmatched).
- Is fast (sub-second per batch) and cheap.
- Handles regional variants and non-Latin scripts noticeably better than
  Claude Sonnet/Opus on the same prompts.

When you run the Claude Code skill, **Claude itself becomes the translator**
(there is no separate model knob). Claude is great at code and reasoning;
multilingual translation, especially for `es-419`, `pt-BR`, `zh-Hant`, `ko`,
and `ja`, is **not** its strong suit. Expect:

- Wooden phrasing in non-English Romance languages.
- Drift in idiomatic terms.
- Occasional outright mistranslations in CJK languages.
- Inconsistent tone between batches (Claude is non-deterministic across runs).

You should run a **native-speaker review** on anything this skill produces
before shipping.

---

## What this skill does

When triggered (see the SKILL.md for the trigger phrases), Claude will:

1. Show you a confirmation dialog with the disclaimer above.
2. Locate `i18n-en.json` (or `Messages.properties`) in the directory you specify.
3. Run `find-missing.mjs` to compute missing keys per locale.
4. For long locales (`pt-BR`, `es-419`, `zh-Hans`, `zh-Hant`, etc.), read the
   matching short locale file (`pt`, `es`, `zh`) as **tone context** so the
   regional variant stays consistent with your existing translations.
5. Translate the missing values in-conversation.
6. Pipe the results to `merge-translations.mjs`, which adds them to the
   target file in the same key order as the English source — never
   overwriting existing translations.

Locale handling is identical to the Cursor extension and follows BCP 47:

| Filename                | Resolves to              |
|-------------------------|--------------------------|
| `i18n-de.json`          | German                   |
| `i18n-pt-BR.json`       | Brazilian Portuguese     |
| `i18n-fr-CA.json`       | Canadian French          |
| `i18n-es-419.json`      | Latin American Spanish   |
| `i18n-es-ES.json`       | European Spanish         |
| `i18n-zh-Hans.json`     | Simplified Chinese       |
| `i18n-zh-Hant.json`     | Traditional Chinese      |
| `i18n-en-GB.json`       | British English          |
| `i18n-pl.json`          | Polish                   |
| `Messages_pt-BR.properties` | Brazilian Portuguese (Java) |

---

## Install

```bash
git clone https://github.com/m3nfis/cursor-i18n-sync-translations.git
cd cursor-i18n-sync-translations/docs/claude-code-skill
./install.sh
```

The installer copies the skill to `~/.claude/skills/i18n-sync/`. Re-run
`./install.sh` any time to upgrade in place.

Requirements:

- Claude Code installed and configured.
- Node.js 18 or newer on `PATH`.

## Use

Inside Claude Code, ask in plain English:

- "sync i18n translations in `src/assets/i18n/`"
- "translate the missing keys for `i18n-pt-BR.json`"
- "fill in missing translations across all language files"

The skill will fire, print the disclaimer, wait for your confirmation,
then walk through the procedure.

## Uninstall

```bash
./uninstall.sh
```

Removes `~/.claude/skills/i18n-sync/`.

---

## When to give up and use the Cursor extension instead

- You're shipping translations to production users.
- You're translating into CJK languages (Chinese, Japanese, Korean).
- You're translating long batches (> 50 keys per language) and consistency matters.
- A native speaker has reviewed the Claude output and the bug count per file
  is non-trivial.

For all of these, switch to the Cursor extension with `gemini-3-flash`.
That's not a soft suggestion — it's the difference between a usable
translation and one your localisation team has to rewrite.
