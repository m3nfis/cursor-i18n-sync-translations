import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { detectProjectConfig, ProjectConfig } from './fileHandlers';
import { translateKeyBatch, createBatches, TranslationBatch, getConfig as getTranslationConfig } from './translationEngine';
import { StateManager, SyncState } from './stateManager';
import { findMissingKeys, mergeSingleLanguage, loadLangContextWithFallback } from './syncUtils';
import { initAutoSync, disposeAutoSync } from './autoSync';
import { I18N_JSON_FILE_REGEX } from './localeUtils';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

// ---------------------------------------------------------------------------
// Activation / Deactivation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('i18n Sync Translations');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'i18nSync.syncTranslations';
  context.subscriptions.push(statusBarItem);

  updateStatusBar('idle');

  // Register commands
  const syncCmd = vscode.commands.registerCommand('i18nSync.syncTranslations', () =>
    runSyncFromActiveEditor()
  );
  const checkCmd = vscode.commands.registerCommand('i18nSync.checkMissing', () =>
    runCheckMissing()
  );
  const contextCmd = vscode.commands.registerCommand(
    'i18nSync.syncTranslationsFromContext',
    (uri: vscode.Uri) => runSyncFromUri(uri)
  );

  context.subscriptions.push(syncCmd, checkCmd, contextCmd, outputChannel);

  // Show/hide status bar based on active editor
  showStatusBarIfRelevant();
  vscode.window.onDidChangeActiveTextEditor(
    () => showStatusBarIfRelevant(),
    null,
    context.subscriptions
  );

  // Background auto-sync
  initAutoSync(context, outputChannel, statusBarItem);
}

export function deactivate(): void {
  disposeAutoSync();
  statusBarItem?.dispose();
  outputChannel?.dispose();
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

const I18N_FILE_PATTERN = I18N_JSON_FILE_REGEX;

function showStatusBarIfRelevant(): void {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const fileName = path.basename(editor.document.fileName);
    if (
      fileName === 'i18n-en.json' ||
      fileName === 'Messages.properties' ||
      I18N_FILE_PATTERN.test(fileName)
    ) {
      statusBarItem.show();
      return;
    }
  }
  statusBarItem.hide();
}

function updateStatusBar(state: 'idle' | 'running' | 'done' | 'error', detail?: string): void {
  switch (state) {
    case 'idle':
      statusBarItem.text = '$(globe) i18n Sync';
      statusBarItem.tooltip = 'Click to sync missing translations';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'running':
      statusBarItem.text = `$(sync~spin) i18n Syncing${detail ? ': ' + detail : '...'}`;
      statusBarItem.tooltip = 'Translation sync in progress...';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      break;
    case 'done':
      statusBarItem.text = '$(check) i18n Synced';
      statusBarItem.tooltip = detail || 'All translations are in sync';
      statusBarItem.backgroundColor = undefined;
      setTimeout(() => updateStatusBar('idle'), 5000);
      break;
    case 'error':
      statusBarItem.text = '$(error) i18n Sync Failed';
      statusBarItem.tooltip = detail || 'Translation sync failed';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      setTimeout(() => updateStatusBar('idle'), 8000);
      break;
  }
}

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the i18n directory from a URI or the active editor.
 * Wraps `fs.statSync` in a try-catch to handle permission/access errors.
 */
function resolveI18nDir(uri?: vscode.Uri): string | null {
  if (uri) {
    try {
      const stat = fs.statSync(uri.fsPath);
      return stat.isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
    } catch {
      return null;
    }
  }

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    return path.dirname(editor.document.fileName);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function runSyncFromActiveEditor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('i18n Sync: Open an i18n file (e.g., i18n-en.json) first.');
    return;
  }
  const i18nDir = path.dirname(editor.document.fileName);
  return runSync(i18nDir);
}

async function runSyncFromUri(uri: vscode.Uri): Promise<void> {
  const i18nDir = resolveI18nDir(uri);
  if (!i18nDir) {
    vscode.window.showWarningMessage('i18n Sync: Could not determine i18n directory.');
    return;
  }
  return runSync(i18nDir);
}

async function runCheckMissing(): Promise<void> {
  const i18nDir = resolveI18nDir();
  if (!i18nDir) {
    vscode.window.showWarningMessage('i18n Sync: Open an i18n file first.');
    return;
  }

  const config = detectProjectConfig(i18nDir);
  if (!config) {
    vscode.window.showErrorMessage(
      'i18n Sync: No i18n-en.json or Messages.properties found in this directory.'
    );
    return;
  }

  outputChannel.show(true);
  logSeparator();
  outputChannel.appendLine(`Checking missing translations in: ${i18nDir}`);
  outputChannel.appendLine(`Detected format: ${config.mode === 'json' ? 'JSON' : 'Java Properties'}`);
  logSeparator();

  const { missingKeysByLang, totalMissing } = findMissingKeys(i18nDir, config);

  if (totalMissing === 0) {
    outputChannel.appendLine('\nAll language files are in sync! No missing translations.');
    vscode.window.showInformationMessage('i18n Sync: All translations are in sync!');
    return;
  }

  for (const lang of Object.keys(missingKeysByLang)) {
    const keys = Object.keys(missingKeysByLang[lang]);
    outputChannel.appendLine(`\n${lang.toUpperCase()} - ${keys.length} missing key(s):`);
    for (const k of keys) {
      outputChannel.appendLine(`  "${k}": "${missingKeysByLang[lang][k]}"`);
    }
  }

  outputChannel.appendLine(`\nTotal: ${totalMissing} missing key-language pair(s)`);

  const action = await vscode.window.showWarningMessage(
    `i18n Sync: Found ${totalMissing} missing translation(s). Sync now?`,
    'Sync Now',
    'View Details'
  );

  if (action === 'Sync Now') {
    return runSync(i18nDir);
  }
}

// ---------------------------------------------------------------------------
// Core sync orchestration
// ---------------------------------------------------------------------------

async function runSync(i18nDir: string): Promise<void> {
  const config = detectProjectConfig(i18nDir);
  if (!config) {
    vscode.window.showErrorMessage(
      'i18n Sync: No i18n-en.json or Messages.properties found. Navigate to a directory containing i18n files.'
    );
    return;
  }

  // Check for resumable state
  const stateManager = new StateManager(i18nDir);
  let state: SyncState | null = null;
  let isResuming = false;

  if (stateManager.hasResumableState()) {
    const choice = await vscode.window.showInformationMessage(
      'i18n Sync: Found a previous incomplete sync. Resume?',
      'Resume',
      'Start Fresh'
    );
    if (choice === 'Resume') {
      state = stateManager.load();
      isResuming = true;
    } else if (choice === 'Start Fresh') {
      stateManager.cleanup();
    } else {
      return; // Dismissed
    }
  }

  const translationCfg = getTranslationConfig();

  // Log header
  outputChannel.show(true);
  logSeparator();
  outputChannel.appendLine(`i18n Translation Sync - ${new Date().toLocaleString()}`);
  outputChannel.appendLine(`Directory: ${i18nDir}`);
  outputChannel.appendLine(`Format: ${config.mode === 'json' ? 'JSON' : 'Java Properties'}`);

  const modelDisplay = translationCfg.model || '(Cursor default)';
  const isRecommendedModel = ['gemini-3-flash', 'gemini-3-pro'].includes(translationCfg.model);
  outputChannel.appendLine(
    `Model: ${modelDisplay}${isRecommendedModel ? '' : '  (tip: gemini-3-flash is recommended for translations)'}`
  );
  outputChannel.appendLine(`Context window: ${translationCfg.contextWindowSize} adjacent keys`);
  logSeparator();

  // Step 1: Detect missing keys (or use resumed state)
  if (!state) {
    outputChannel.appendLine('\nStep 1: Detecting missing keys...');
    const { missingKeysByLang, totalMissing } = findMissingKeys(i18nDir, config);

    if (totalMissing === 0) {
      outputChannel.appendLine('All language files are in sync!');
      vscode.window.showInformationMessage('i18n Sync: All translations are already in sync!');
      updateStatusBar('done', 'All translations in sync');
      return;
    }

    outputChannel.appendLine(
      `Found ${totalMissing} missing translation(s) across ${Object.keys(missingKeysByLang).length} language(s).`
    );
    for (const lang of Object.keys(missingKeysByLang)) {
      outputChannel.appendLine(`  ${lang.toUpperCase()}: ${Object.keys(missingKeysByLang[lang]).length} missing`);
    }

    state = {
      status: 'compared',
      missingKeysByLang,
      translatedResults: {},
      completedBatchIds: [],
      completedLanguages: [],
    };
    stateManager.save(state);
  }

  // Step 2: Translate
  const { missingKeysByLang, translatedResults } = state;
  const { batches, batchCountByLang } = createBatches(missingKeysByLang);
  const batchesToProcess = batches.filter(b => !state!.completedBatchIds.includes(b.id));

  if (batchesToProcess.length === 0) {
    outputChannel.appendLine('All translation work was already complete.');
    mergeRemainingTranslations(config, i18nDir, state, stateManager);
    return;
  }

  const logMsg = isResuming ? 'Resuming translation' : 'Starting translation';
  outputChannel.appendLine(
    `\nStep 2: ${logMsg}. Processing ${batchesToProcess.length} of ${batches.length} batch(es)...`
  );

  updateStatusBar('running');

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18n Sync: Translating',
      cancellable: true,
    },
    async (progress, token) => {
      const enData = config.readFile(config.enFilePath) || {};
      const enKeys = Object.keys(enData);
      const langDataCache: Record<string, Record<string, string> | null> = {};
      let completedCount = batches.length - batchesToProcess.length;

      for (let i = 0; i < batchesToProcess.length; i += translationCfg.concurrentLimit) {
        if (token.isCancellationRequested) {
          outputChannel.appendLine('\nSync cancelled by user. Progress saved - you can resume later.');
          vscode.window.showWarningMessage('i18n Sync: Cancelled. Progress has been saved for resuming.');
          updateStatusBar('idle');
          return;
        }

        const chunk = batchesToProcess.slice(i, i + translationCfg.concurrentLimit);

        progress.report({
          message: `Batch ${completedCount + 1}/${batches.length} (${chunk.map(b => b.lang.toUpperCase()).join(', ')})`,
          increment: 0,
        });

        await Promise.all(
          chunk.map(async (job: TranslationBatch) => {
            const keyCount = Object.keys(job.batch).length;
            outputChannel.appendLine(
              `  [Batch ${job.id} | ${job.lang.toUpperCase()}] Sending ${keyCount} key(s) with context...`
            );
            updateStatusBar('running', `${job.lang.toUpperCase()} batch ${job.id}`);

            // Lazy-load language data; long locales fall back to the short
            // locale's translations so the model has consistent context.
            if (!(job.lang in langDataCache)) {
              const loaded = loadLangContextWithFallback(config, job.lang);
              langDataCache[job.lang] = loaded.data;
              if (loaded.fellBackTo) {
                outputChannel.appendLine(
                  `  [Batch ${job.id} | ${job.lang.toUpperCase()}] Using ${loaded.fellBackTo.toUpperCase()} as context fallback (no existing ${job.lang} file)`
                );
              }
            }

            const result = await translateKeyBatch(
              job.batch,
              job.lang,
              job.id,
              outputChannel,
              token,
              enData,
              langDataCache[job.lang]
            );

            if (!translatedResults[job.lang]) {
              translatedResults[job.lang] = {};
            }
            Object.assign(translatedResults[job.lang], result.data);

            const status = result.success ? 'OK' : 'FAILED (fallback)';
            outputChannel.appendLine(`  [Batch ${job.id} | ${job.lang.toUpperCase()}] ${status}`);

            state!.completedBatchIds.push(job.id);
            stateManager.save(state!);

            completedCount++;
            progress.report({ increment: (1 / batches.length) * 100 });

            // Eagerly merge when all batches for a language are done
            const completedForLang = state!.completedBatchIds.filter(id => {
              const b = batches.find(batch => batch.id === id);
              return b && b.lang === job.lang;
            }).length;

            if (
              completedForLang === batchCountByLang[job.lang] &&
              !state!.completedLanguages.includes(job.lang)
            ) {
              outputChannel.appendLine(
                `\n  [${job.lang.toUpperCase()}] All batches complete - merging to file...`
              );
              const added = mergeSingleLanguage(config, job.lang, translatedResults[job.lang], enKeys);
              outputChannel.appendLine(
                `  [${job.lang.toUpperCase()}] Merged ${added} new key(s) into ${path.basename(config.getLangFilePath(job.lang))}`
              );
              state!.completedLanguages.push(job.lang);
              stateManager.save(state!);
            }
          })
        );
      }

      outputChannel.appendLine('\nAll translation batches processed.');
      mergeRemainingTranslations(config, i18nDir, state!, stateManager);
    }
  );
}

// ---------------------------------------------------------------------------
// Final merge + summary
// ---------------------------------------------------------------------------

function mergeRemainingTranslations(
  config: ProjectConfig,
  _i18nDir: string,
  state: SyncState,
  stateManager: StateManager
): void {
  outputChannel.appendLine('\nStep 3: Merging remaining translations...');
  const enData = config.readFile(config.enFilePath);
  const enKeys = Object.keys(enData || {});
  const summary: { lang: string; count: number }[] = [];

  for (const lang of Object.keys(state.translatedResults)) {
    if (state.completedLanguages?.includes(lang)) {
      outputChannel.appendLine(`  [${lang.toUpperCase()}] Already merged.`);
      continue;
    }

    const count = mergeSingleLanguage(config, lang, state.translatedResults[lang], enKeys);
    if (count > 0) {
      outputChannel.appendLine(
        `  [${lang.toUpperCase()}] Merged ${count} new key(s) into ${path.basename(config.getLangFilePath(lang))}`
      );
      summary.push({ lang, count });
    }
  }

  logSeparator();
  outputChannel.appendLine('SUMMARY');
  logSeparator();

  if (summary.length > 0) {
    let totalAdded = 0;
    for (const { lang, count } of summary) {
      outputChannel.appendLine(`  ${lang.toUpperCase()}: +${count} translation(s)`);
      totalAdded += count;
    }
    outputChannel.appendLine(`\nTotal: ${totalAdded} new translation(s) added.`);
    vscode.window.showInformationMessage(
      `i18n Sync: Added ${totalAdded} translation(s) across ${summary.length} language(s).`
    );
    updateStatusBar('done', `Added ${totalAdded} translations`);
  } else {
    const alreadyMerged = state.completedLanguages?.length || 0;
    if (alreadyMerged > 0) {
      outputChannel.appendLine('  All translations were merged during batch processing.');
      vscode.window.showInformationMessage('i18n Sync: All translations synced successfully!');
      updateStatusBar('done', 'All translations synced');
    } else {
      outputChannel.appendLine('  No new translations were added.');
      updateStatusBar('done', 'No new translations needed');
    }
  }

  stateManager.cleanup();
  outputChannel.appendLine('\nSync complete.');
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

const SEPARATOR = '='.repeat(60);

function logSeparator(): void {
  outputChannel.appendLine(`\n${SEPARATOR}`);
}
