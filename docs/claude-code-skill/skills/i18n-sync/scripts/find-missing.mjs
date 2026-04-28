#!/usr/bin/env node
// Enumerate i18n keys that exist in the English source but are missing from
// each sibling language file. Mirrors the matching rules of the Cursor
// extension (BCP 47 long-locale support included).
//
// Usage:
//   node find-missing.mjs <i18n-dir>
//
// Output: a JSON object on stdout. See the surrounding SKILL.md for shape.

import * as fs from 'node:fs';
import * as path from 'node:path';

const LOCALE_SUBTAG = /[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*/;
const JSON_REGEX = new RegExp(`^i18n-(${LOCALE_SUBTAG.source})\\.json$`);
const PROPS_REGEX = new RegExp(`^Messages_(${LOCALE_SUBTAG.source})\\.properties$`);

function isLongLocale(locale) {
  return locale.includes('-');
}

function getShortLocale(locale) {
  return locale.split('-', 1)[0];
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Minimal Java .properties parser — enough for missing-key detection.
function readProperties(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const out = {};
  let key = null;
  let value = '';
  let cont = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine;
    if (!cont) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
      const sep = line.search(/[=:]/);
      if (sep === -1) continue;
      key = line.slice(0, sep).trim();
      value = line.slice(sep + 1).trim();
    } else {
      value += line.replace(/^\s+/, ' ');
    }
    if (value.trimEnd().endsWith('\\')) {
      value = value.trimEnd().slice(0, -1);
      cont = true;
    } else {
      out[key] = value;
      cont = false;
    }
  }
  if (cont && key !== null) out[key] = value;
  return out;
}

function main() {
  const i18nDir = process.argv[2];
  if (!i18nDir) {
    console.error('Usage: find-missing.mjs <i18n-dir>');
    process.exit(2);
  }
  if (!fs.existsSync(i18nDir) || !fs.statSync(i18nDir).isDirectory()) {
    console.error(`Not a directory: ${i18nDir}`);
    process.exit(2);
  }

  const jsonEn = path.join(i18nDir, 'i18n-en.json');
  const propsEn = path.join(i18nDir, 'Messages.properties');

  let mode, regex, readFile, baseFile;
  if (fs.existsSync(jsonEn)) {
    mode = 'json';
    regex = JSON_REGEX;
    readFile = readJson;
    baseFile = jsonEn;
  } else if (fs.existsSync(propsEn)) {
    mode = 'properties';
    regex = PROPS_REGEX;
    readFile = readProperties;
    baseFile = propsEn;
  } else {
    console.error('No i18n-en.json or Messages.properties found in this directory.');
    process.exit(3);
  }

  const enData = readFile(baseFile);
  if (!enData) {
    console.error(`Could not parse the English source file: ${baseFile}`);
    process.exit(4);
  }
  const enKeys = Object.keys(enData);
  const enKeySet = new Set(enKeys);

  const allFiles = fs.readdirSync(i18nDir).filter(f => regex.test(f));
  const langs = [];
  for (const f of allFiles) {
    const m = regex.exec(f);
    if (!m) continue;
    const lang = m[1];
    if (lang === 'en') continue;
    langs.push(lang);
  }

  const missingByLang = {};
  const fallbackByLang = {};
  const strayByLang = {};
  let totalMissing = 0;

  for (const lang of langs) {
    const filePath = path.join(i18nDir,
      mode === 'json' ? `i18n-${lang}.json` : `Messages_${lang}.properties`);
    const data = readFile(filePath) ?? {};
    const have = new Set(Object.keys(data));
    const missing = enKeys.filter(k => !have.has(k));
    if (missing.length > 0) {
      const map = {};
      for (const k of missing) map[k] = enData[k];
      missingByLang[lang] = map;
      totalMissing += missing.length;
    }

    // Recommend a short-locale tone reference for long locales whose own
    // file is empty/missing. Skip when the short locale would be `en` —
    // the English source is already part of the prompt input, so suggesting
    // it as "fallback" is redundant and misleading.
    if (isLongLocale(lang)) {
      const shortLang = getShortLocale(lang);
      if (shortLang && shortLang !== lang && shortLang !== 'en') {
        const shortPath = path.join(i18nDir,
          mode === 'json' ? `i18n-${shortLang}.json` : `Messages_${shortLang}.properties`);
        if (fs.existsSync(shortPath)) {
          const shortData = readFile(shortPath);
          const longIsEmpty = Object.keys(data).length === 0;
          if (longIsEmpty && shortData && Object.keys(shortData).length > 0) {
            fallbackByLang[lang] = shortLang;
          }
        }
      }
    }

    // Surface keys present in the language file but missing from English.
    // The agent can decide whether to flag, ignore, or remove them.
    const stray = Object.keys(data).filter(k => !enKeySet.has(k));
    if (stray.length > 0) {
      strayByLang[lang] = Object.fromEntries(stray.map(k => [k, data[k]]));
    }
  }

  process.stdout.write(JSON.stringify({
    mode,
    enKeys,
    missingByLang,
    fallbackByLang,
    strayByLang,
    totalMissing,
  }, null, 2));
}

main();
