#!/usr/bin/env node
// End-to-end test harness for the i18n-sync-extension.
//
// Drives the *real* compiled extension code (out/translationEngine.js,
// out/contextInference.js, out/syncUtils.js, out/localeUtils.js) against
// the test-app's locale files. Stubs the `vscode` module so the engine
// runs outside of a VS Code host.
//
// Procedure:
//   1. Snapshot the current locale files (treated as source-of-truth).
//   2. For each non-English language, delete a controlled set of 5 keys.
//   3. Run the extension's findMissingKeys -> createBatches ->
//      translateKeyBatch -> mergeSingleLanguage pipeline, exactly the
//      same code paths the VS Code command invokes.
//   4. Validate structural integrity (key parity, placeholders, HTML tags)
//      via the existing validate-translations.mjs.
//   5. Score per-key vs the source-of-truth: exact match / lenient match
//      (case-insensitive, whitespace-collapsed) / different.
//   6. Restore the source-of-truth files no matter what.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const localesDir = path.resolve(__dirname, '../src/locales');
const outDir = path.join(repoRoot, 'out');

// Make sure the extension is compiled.
if (!fs.existsSync(path.join(outDir, 'translationEngine.js'))) {
  console.error(`Compiled extension missing at ${outDir}. Run \`npm run compile\` in the repo root first.`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// vscode stub — minimal surface area used by the engine modules.
// ---------------------------------------------------------------------------
const fakeVscode = {
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => {
        const overrides = {
          model: process.env.I18N_SYNC_TEST_MODEL || 'gemini-3-flash',
          contextWindowSize: 5,
          batchSize: 40,
          concurrentLimit: 2,
          maxRetries: 3,
          translationTone: 'formal business',
          cursorCliPath: process.env.I18N_SYNC_TEST_CLI_PATH || 'auto',
          cliTimeoutSeconds: Number(process.env.I18N_SYNC_TEST_TIMEOUT_S) || 90,
          debugMode: process.env.I18N_SYNC_TEST_DEBUG === '1',
        };
        if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
        return fallback;
      },
    }),
  },
  window: {
    showErrorMessage: msg => console.error(`[stub showErrorMessage] ${msg}`),
    showWarningMessage: msg => console.warn(`[stub showWarningMessage] ${msg}`),
    showInformationMessage: msg => console.log(`[stub showInformationMessage] ${msg}`),
  },
};

// Inject the stub before requiring any compiled extension module.
const Module = createRequire(import.meta.url)('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'vscode') return require.resolve.paths ? '__vscode_stub__' : '__vscode_stub__';
  return origResolve.call(this, request, parent, ...rest);
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  return origLoad.call(this, request, ...rest);
};

const require = createRequire(import.meta.url);
const { translateKeyBatch, createBatches } = require(path.join(outDir, 'translationEngine.js'));
const { findMissingKeys, mergeSingleLanguage, loadLangContextWithFallback } = require(path.join(outDir, 'syncUtils.js'));
const { detectProjectConfig } = require(path.join(outDir, 'fileHandlers.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const COLOR = { reset:'\x1b[0m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', blue:'\x1b[34m', cyan:'\x1b[36m', dim:'\x1b[2m', bold:'\x1b[1m' };

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, data) { fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8'); }

function normaliseForLenientMatch(s) {
  return String(s).toLowerCase().replaceAll(/\s+/g, ' ').trim();
}

// Minimal CancellationToken stub.
const noopToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => {} }),
};

// Minimal OutputChannel stub.
const channel = {
  appendLine: line => process.stdout.write(`  ${COLOR.dim}${line}${COLOR.reset}\n`),
  show: () => {},
  dispose: () => {},
};

// ---------------------------------------------------------------------------
// Test driver
// ---------------------------------------------------------------------------
const KEYS_TO_DELETE_PER_LANG = {
  es: ['ctaButton', 'roomSummary', 'breakfastToggle', 'roomOptions', 'cancellationTerms'],
  fr: ['guestLabel', 'trustNote', 'footerHelp', 'legalDisclaimer', 'cancellationTerms'],
  zh: ['heroSubtitle', 'checkOutLabel', 'breakfastToggle', 'roomOptions', 'legalDisclaimer'],
};

async function main() {
  console.log(`${COLOR.bold}${COLOR.cyan}=== i18n-sync-extension end-to-end test ===${COLOR.reset}`);
  console.log(`Locale dir:   ${localesDir}`);
  console.log(`Model:        ${process.env.I18N_SYNC_TEST_MODEL || 'gemini-3-flash'}`);
  console.log(`Tone:         formal business`);
  console.log(`Context:      5 sibling keys`);
  console.log('');

  // 1. Snapshot
  const truthByLang = {};
  for (const lang of Object.keys(KEYS_TO_DELETE_PER_LANG)) {
    const file = path.join(localesDir, `i18n-${lang}.json`);
    truthByLang[lang] = readJson(file);
  }
  const enData = readJson(path.join(localesDir, 'i18n-en.json'));
  const enKeys = Object.keys(enData);

  // 2. Mutate: delete chosen keys.
  const removedByLang = {};
  for (const [lang, keys] of Object.entries(KEYS_TO_DELETE_PER_LANG)) {
    const file = path.join(localesDir, `i18n-${lang}.json`);
    const next = { ...truthByLang[lang] };
    for (const k of keys) delete next[k];
    writeJson(file, next);
    removedByLang[lang] = keys;
  }

  console.log(`${COLOR.bold}Step 1 — Removed keys to simulate missing translations${COLOR.reset}`);
  for (const [lang, keys] of Object.entries(removedByLang)) {
    console.log(`  ${lang}: ${keys.join(', ')}`);
  }
  console.log('');

  // 3. Detect missing.
  const config = detectProjectConfig(localesDir);
  if (!config) throw new Error('detectProjectConfig returned null');
  const { missingKeysByLang, totalMissing } = findMissingKeys(localesDir, config, enData);
  console.log(`${COLOR.bold}Step 2 — findMissingKeys${COLOR.reset}`);
  console.log(`  Total missing: ${totalMissing}`);
  for (const lang of Object.keys(missingKeysByLang)) {
    console.log(`  ${lang}: ${Object.keys(missingKeysByLang[lang]).length} missing`);
  }
  console.log('');

  // 4. Translate.
  console.log(`${COLOR.bold}Step 3 — Translate (real cursor CLI calls)${COLOR.reset}`);
  const { batches, batchCountByLang } = createBatches(missingKeysByLang);
  const langDataCache = {};
  const results = {};
  let batchOk = 0;
  let batchFail = 0;
  const t0 = Date.now();

  for (const batch of batches) {
    if (!(batch.lang in langDataCache)) {
      langDataCache[batch.lang] = loadLangContextWithFallback(config, batch.lang).data;
    }
    process.stdout.write(`  [Batch ${batch.id} | ${batch.lang.toUpperCase()}] ${Object.keys(batch.batch).length} keys...`);
    const t = Date.now();
    const out = await translateKeyBatch(
      batch.batch,
      batch.lang,
      batch.id,
      channel,
      noopToken,
      enData,
      langDataCache[batch.lang]
    );
    const dt = ((Date.now() - t) / 1000).toFixed(1);
    if (out.success) {
      batchOk++;
      process.stdout.write(`  ${COLOR.green}OK${COLOR.reset}  (${dt}s)\n`);
    } else {
      batchFail++;
      process.stdout.write(`  ${COLOR.red}FAIL${COLOR.reset}  (${dt}s)\n`);
    }
    results[batch.lang] = { ...(results[batch.lang] || {}), ...out.data };
  }
  const totalDt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  Total: ${batchOk} ok, ${batchFail} fail, ${totalDt}s wall.`);
  console.log('');

  // 5. Merge.
  console.log(`${COLOR.bold}Step 4 — Merge translations into files${COLOR.reset}`);
  for (const lang of Object.keys(results)) {
    const added = mergeSingleLanguage(config, lang, results[lang], enKeys);
    console.log(`  ${lang}: merged ${added} new key(s) into i18n-${lang}.json`);
  }
  console.log('');

  // 6. Structural validation via the test-app's existing checker.
  console.log(`${COLOR.bold}Step 5 — Structural validation (placeholders + HTML tags + key parity)${COLOR.reset}`);
  const validate = spawnSync(process.execPath, [path.join(__dirname, 'validate-translations.mjs')], { encoding: 'utf8' });
  if (validate.status === 0) {
    console.log(`  ${COLOR.green}PASS${COLOR.reset} ${validate.stdout.trim()}`);
  } else {
    console.log(`  ${COLOR.red}FAIL${COLOR.reset}`);
    if (validate.stdout) console.log(validate.stdout);
    if (validate.stderr) console.log(validate.stderr);
  }
  console.log('');

  // 7. Score per-key vs source-of-truth.
  console.log(`${COLOR.bold}Step 6 — Per-key score vs source-of-truth${COLOR.reset}`);
  const tableRows = [];
  let exact = 0, lenient = 0, different = 0;
  for (const [lang, keys] of Object.entries(removedByLang)) {
    const file = path.join(localesDir, `i18n-${lang}.json`);
    const written = readJson(file);
    for (const key of keys) {
      const expected = String(truthByLang[lang][key] ?? '');
      const actual = String(written[key] ?? '');
      let verdict;
      if (actual === expected) { verdict = 'EXACT'; exact++; }
      else if (normaliseForLenientMatch(actual) === normaliseForLenientMatch(expected)) { verdict = 'LENIENT'; lenient++; }
      else { verdict = 'DIFFERENT'; different++; }
      tableRows.push({ lang, key, verdict, expected, actual });
    }
  }
  for (const row of tableRows) {
    const colour = row.verdict === 'EXACT' ? COLOR.green : row.verdict === 'LENIENT' ? COLOR.yellow : COLOR.red;
    console.log(`  ${colour}${row.verdict.padEnd(9)}${COLOR.reset} ${row.lang}.${row.key}`);
    if (row.verdict !== 'EXACT') {
      console.log(`    ${COLOR.dim}expected:${COLOR.reset} ${row.expected}`);
      console.log(`    ${COLOR.dim}actual:  ${COLOR.reset} ${row.actual}`);
    }
  }
  console.log('');
  console.log(`${COLOR.bold}Score: ${exact} exact / ${lenient} lenient / ${different} different (out of ${exact+lenient+different})${COLOR.reset}`);

  return {
    batchOk, batchFail, totalDt,
    structural: validate.status === 0,
    exact, lenient, different,
    rows: tableRows,
    truthByLang,
  };
}

// Always restore the source-of-truth files at the end.
async function withRestore(fn) {
  const truth = {};
  for (const lang of Object.keys(KEYS_TO_DELETE_PER_LANG)) {
    truth[lang] = readJson(path.join(localesDir, `i18n-${lang}.json`));
  }
  let result, err;
  try {
    result = await fn();
  } catch (e) {
    err = e;
  } finally {
    for (const lang of Object.keys(truth)) {
      writeJson(path.join(localesDir, `i18n-${lang}.json`), truth[lang]);
    }
    console.log(`\n${COLOR.dim}(Restored source-of-truth locale files.)${COLOR.reset}`);
  }
  if (err) throw err;
  return result;
}

withRestore(main).then(res => {
  if (!res.structural || res.batchFail > 0) process.exit(1);
  process.exit(0);
}).catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(2);
});
