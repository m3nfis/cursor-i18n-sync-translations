import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig } from './fileHandlers';
import { isLongLocale, getShortLocale } from './localeUtils';

/** Result of scanning language files for missing translation keys. */
export interface MissingKeysResult {
  missingKeysByLang: Record<string, Record<string, string>>;
  totalMissing: number;
}

/**
 * Scans language files in a directory and identifies keys present in the
 * English source file but missing from each target language file.
 *
 * @param i18nDir  - Directory containing the i18n files.
 * @param config   - Detected project configuration.
 * @param enData   - Optional pre-loaded English data (avoids a redundant read).
 */
export function findMissingKeys(
  i18nDir: string,
  config: ProjectConfig,
  enData?: Record<string, string>
): MissingKeysResult {
  const sourceData = enData ?? config.readFile(config.enFilePath);
  if (!sourceData) {
    return { missingKeysByLang: {}, totalMissing: 0 };
  }

  let allFiles: string[];
  try {
    allFiles = fs.readdirSync(i18nDir);
  } catch {
    return { missingKeysByLang: {}, totalMissing: 0 };
  }

  const langFiles = allFiles.filter(f => config.langFileRegex.test(f));
  const enKeys = Object.keys(sourceData);
  const missingKeysByLang: Record<string, Record<string, string>> = {};
  let totalMissing = 0;

  for (const file of langFiles) {
    const lang = config.getLang(file);
    if (lang === 'en') {
      continue;
    }

    const langData = config.readFile(path.join(i18nDir, file)) ?? {};
    const langKeySet = new Set(Object.keys(langData));
    const missing = enKeys.filter(k => !langKeySet.has(k));

    if (missing.length > 0) {
      const missingMap: Record<string, string> = {};
      for (const key of missing) {
        missingMap[key] = sourceData[key];
      }
      missingKeysByLang[lang] = missingMap;
      totalMissing += missing.length;
    }
  }

  return { missingKeysByLang, totalMissing };
}

/**
 * Merges newly translated keys into a single language file.
 * Returns the number of actually-new keys that were written.
 *
 * @param config         - Detected project configuration.
 * @param lang           - Target language code (e.g. "de", "es").
 * @param translatedData - Key/value pairs produced by the translation engine.
 * @param enKeys         - Ordered list of English keys (used to maintain key order).
 */
export function mergeSingleLanguage(
  config: ProjectConfig,
  lang: string,
  translatedData: Record<string, string>,
  enKeys: string[]
): number {
  const filePath = config.getLangFilePath(lang);
  const existingData = config.readFile(filePath) ?? {};
  const newKeyCount = Object.keys(translatedData).filter(
    k => !Object.prototype.hasOwnProperty.call(existingData, k)
  ).length;

  if (newKeyCount > 0) {
    config.mergeTranslations(filePath, existingData, translatedData, enKeys);
  }

  return newKeyCount;
}

/**
 * Loads the existing translations for `lang` to use as **context** when
 * prompting the LLM. If `lang` is a long locale (e.g. `pt-BR`) and its file
 * does not exist (or is empty), falls back to the short locale's file
 * (e.g. `pt`) so the model gets consistent tone/vocabulary.
 *
 * Returns `{ data: null, fellBackTo: null }` when neither file exists —
 * the LLM will then translate from scratch using only the English source.
 */
export function loadLangContextWithFallback(
  config: ProjectConfig,
  lang: string
): { data: Record<string, string> | null; fellBackTo: string | null } {
  const direct = config.readFile(config.getLangFilePath(lang));
  if (direct && Object.keys(direct).length > 0) {
    return { data: direct, fellBackTo: null };
  }

  if (isLongLocale(lang)) {
    const shortLang = getShortLocale(lang);
    if (shortLang && shortLang !== lang) {
      const fallback = config.readFile(config.getLangFilePath(shortLang));
      if (fallback && Object.keys(fallback).length > 0) {
        return { data: fallback, fellBackTo: shortLang };
      }
    }
  }

  return { data: direct, fellBackTo: null };
}
