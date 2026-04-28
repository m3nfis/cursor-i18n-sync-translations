#!/usr/bin/env node
// Merge translated key/value pairs (read as JSON from stdin) into the
// language file for `lang` inside `<i18n-dir>`. Preserves the key order of
// the English source file. Never overwrites keys that already exist in the
// target file — translations from the agent are treated as additive.
//
// Usage:
//   echo '{"key":"value", ...}' | merge-translations.mjs <i18n-dir> <lang>
//
// Output (stdout): a JSON summary `{ "added": N, "file": "..." }`.
// Exit 0 on success, non-zero on failure.

import * as fs from 'node:fs';
import * as path from 'node:path';

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// Minimal Java .properties helpers — append-only merge to keep the original
// file's structure (comments, ordering, multiline values) intact.
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

function appendProperties(filePath, newPairs, enKeys) {
  const prior = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = prior ? prior.split(/\r?\n/) : [];
  let insertAt = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t && !t.startsWith('#') && !t.startsWith('!') && t.includes('=')) {
      insertAt = i + 1;
      break;
    }
  }
  const additions = [];
  for (const k of enKeys) {
    if (Object.prototype.hasOwnProperty.call(newPairs, k)) {
      additions.push(`${k}=${newPairs[k]}`);
    }
  }
  if (additions.length === 0) return;
  const next = [...lines.slice(0, insertAt), ...additions, ...lines.slice(insertAt)];
  fs.writeFileSync(filePath, next.join('\n'), 'utf8');
}

async function main() {
  const i18nDir = process.argv[2];
  const lang = process.argv[3];
  if (!i18nDir || !lang) {
    console.error('Usage: merge-translations.mjs <i18n-dir> <lang>');
    process.exit(2);
  }

  const stdin = (await readStdin()).trim();
  if (!stdin) {
    console.error('Expected JSON object on stdin.');
    process.exit(2);
  }
  let translations;
  try {
    translations = JSON.parse(stdin);
  } catch (e) {
    console.error(`stdin is not valid JSON: ${e.message}`);
    process.exit(2);
  }
  if (translations === null || typeof translations !== 'object' || Array.isArray(translations)) {
    console.error('stdin must be a flat JSON object of key -> string.');
    process.exit(2);
  }

  const jsonEn = path.join(i18nDir, 'i18n-en.json');
  const propsEn = path.join(i18nDir, 'Messages.properties');
  let mode, enFile, langFile, readSource;
  if (fs.existsSync(jsonEn)) {
    mode = 'json';
    enFile = jsonEn;
    langFile = path.join(i18nDir, `i18n-${lang}.json`);
    readSource = readJson;
  } else if (fs.existsSync(propsEn)) {
    mode = 'properties';
    enFile = propsEn;
    langFile = path.join(i18nDir, `Messages_${lang}.properties`);
    readSource = readProperties;
  } else {
    console.error('No i18n source file found in the directory.');
    process.exit(3);
  }

  const enData = readSource(enFile) || {};
  const enKeys = Object.keys(enData);
  const existing = readSource(langFile) || {};
  const additive = {};
  for (const [k, v] of Object.entries(translations)) {
    if (!Object.prototype.hasOwnProperty.call(existing, k)) {
      additive[k] = v;
    }
  }
  const addedCount = Object.keys(additive).length;

  if (mode === 'json') {
    const combined = { ...existing, ...additive };
    const sorted = {};
    for (const k of enKeys) {
      if (Object.prototype.hasOwnProperty.call(combined, k)) sorted[k] = combined[k];
    }
    for (const k of Object.keys(combined)) {
      if (!Object.prototype.hasOwnProperty.call(sorted, k)) sorted[k] = combined[k];
    }
    writeJson(langFile, sorted);
  } else {
    appendProperties(langFile, additive, enKeys);
  }

  process.stdout.write(JSON.stringify({ added: addedCount, file: langFile }) + '\n');
}

main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
