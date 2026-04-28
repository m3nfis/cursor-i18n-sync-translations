/**
 * BCP 47 / RFC 5646 locale utilities.
 *
 * Supports:
 *   - Short language codes: `en`, `de`, `pl`, `vi`, ...
 *   - Region-suffixed long locales: `en-GB`, `pt-BR`, `fr-CA`, `es-ES`
 *   - Numeric M.49 region codes: `es-419` (Spanish — Latin America)
 *   - Script subtags: `zh-Hans`, `zh-Hant`, `sr-Cyrl`, `sr-Latn`
 *
 * The single source of truth for "is this filename an i18n file we
 * recognise?" is `LOCALE_SUBTAG_PATTERN` — every regex elsewhere in the
 * codebase composes it instead of redefining its own character class.
 */

/**
 * Matches a BCP 47 locale subtag chain:
 *   2-3 letter language + optional `-script` / `-region` subtags
 *   (each subtag is 2-8 alphanumeric chars).
 *
 * Captures nothing on purpose — callers wrap it in their own group.
 */
export const LOCALE_SUBTAG_PATTERN = /[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*/;

/** Filename matcher for `i18n-{locale}.json`. Captures the locale. */
export const I18N_JSON_FILE_REGEX = new RegExp(
  String.raw`^i18n-(${LOCALE_SUBTAG_PATTERN.source})\.json$`
);

/** Filename matcher for `Messages_{locale}.properties`. Captures the locale. */
export const MESSAGES_PROPERTIES_FILE_REGEX = new RegExp(
  String.raw`^Messages_(${LOCALE_SUBTAG_PATTERN.source})\.properties$`
);

/** True if the locale code carries a region or script subtag (e.g. `pt-BR`, `zh-Hans`). */
export function isLongLocale(locale: string): boolean {
  return locale.includes('-');
}

/**
 * Returns the base language subtag for a locale.
 *
 *   `pt-BR`   -> `pt`
 *   `es-419`  -> `es`
 *   `zh-Hans` -> `zh`
 *   `pt`      -> `pt`
 */
export function getShortLocale(locale: string): string {
  return locale.split('-', 1)[0];
}

/**
 * Resolves a locale code to a human-readable language name suitable for
 * an LLM prompt (e.g. `pt-BR` -> `Brazilian Portuguese`, `es-419` ->
 * `Latin American Spanish`).
 *
 * Uses ECMAScript's built-in `Intl.DisplayNames` (Node 13+ / VS Code 1.85+).
 * Falls back to the raw code on platforms where the API is unavailable
 * or fails to resolve a value.
 */
export function getLanguageDisplayName(locale: string): string {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const dn = new Intl.DisplayNames(['en'], { type: 'language' });
      const name = dn.of(locale);
      if (name && name.toLowerCase() !== locale.toLowerCase()) {
        return name;
      }
    }
  } catch {
    // fall through
  }
  return locale;
}
