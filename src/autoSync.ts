import * as vscode from 'vscode';
import * as path from 'path';
import { detectProjectConfig } from './fileHandlers';
import { translateKeyBatch, createBatches, getConfig as getTranslationConfig } from './translationEngine';
import { StateManager } from './stateManager';
import { findMissingKeys, mergeSingleLanguage, loadLangContextWithFallback } from './syncUtils';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let watcher: vscode.FileSystemWatcher | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let isRunning = false;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let cancellationSource: vscode.CancellationTokenSource | undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialises the auto-sync subsystem. Must be called from `activate()`.
 * Listens for configuration changes and starts/stops the file watcher.
 */
export function initAutoSync(
  context: vscode.ExtensionContext,
  channel: vscode.OutputChannel,
  statusBar: vscode.StatusBarItem
): void {
  outputChannel = channel;
  statusBarItem = statusBar;

  applyAutoSyncSetting(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (
        e.affectsConfiguration('i18nSync.autoSync') ||
        e.affectsConfiguration('i18nSync.autoSyncIntervalMinutes')
      ) {
        applyAutoSyncSetting(context);
      }
    })
  );
}

/** Tears down the auto-sync subsystem. Must be called from `deactivate()`. */
export function disposeAutoSync(): void {
  disposeWatcher();
}

// ---------------------------------------------------------------------------
// Configuration wiring
// ---------------------------------------------------------------------------

function applyAutoSyncSetting(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration('i18nSync');
  const enabled = cfg.get<boolean>('autoSync', false);

  disposeWatcher();

  if (enabled) {
    startWatching(context);
    outputChannel.appendLine('[Auto-Sync] Enabled - watching for i18n file changes');
  } else {
    outputChannel.appendLine('[Auto-Sync] Disabled');
  }
}

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------

function startWatching(context: vscode.ExtensionContext): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    outputChannel.appendLine('[Auto-Sync] No workspace folder open - cannot watch files');
    return;
  }

  const pattern = new vscode.RelativePattern(
    workspaceFolder,
    '**/{i18n-en.json,Messages.properties}'
  );

  watcher = vscode.workspace.createFileSystemWatcher(pattern);
  watcher.onDidChange(uri => onBaseFileChanged(uri));
  watcher.onDidCreate(uri => onBaseFileChanged(uri));

  context.subscriptions.push(watcher);
}

function onBaseFileChanged(uri: vscode.Uri): void {
  const cfg = vscode.workspace.getConfiguration('i18nSync');
  if (!cfg.get<boolean>('autoSync', false)) {
    return;
  }

  const intervalMinutes = cfg.get<number>('autoSyncIntervalMinutes', 3);
  const intervalMs = intervalMinutes * 60 * 1000;
  const fileName = path.basename(uri.fsPath);

  outputChannel.appendLine(
    `[Auto-Sync] Detected change in ${fileName} - scheduling sync in ${intervalMinutes}min`
  );

  // Debounce: reset the timer on each save so rapid edits batch together
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    runBackgroundSync(path.dirname(uri.fsPath));
  }, intervalMs);
}

// ---------------------------------------------------------------------------
// Background sync
// ---------------------------------------------------------------------------

async function runBackgroundSync(i18nDir: string): Promise<void> {
  if (isRunning) {
    outputChannel.appendLine('[Auto-Sync] Sync already in progress, skipping');
    return;
  }

  const config = detectProjectConfig(i18nDir);
  if (!config) {
    return;
  }

  const enData = config.readFile(config.enFilePath);
  if (!enData) {
    return;
  }

  const { missingKeysByLang, totalMissing } = findMissingKeys(i18nDir, config, enData);

  if (totalMissing === 0) {
    outputChannel.appendLine('[Auto-Sync] All translations in sync, nothing to do');
    return;
  }

  isRunning = true;
  cancellationSource = new vscode.CancellationTokenSource();

  const translationCfg = getTranslationConfig();
  outputChannel.appendLine(
    `[Auto-Sync] Starting background sync: ${totalMissing} missing key(s), model: ${translationCfg.model || '(default)'}`
  );
  updateStatusBarAutoSync('running');

  try {
    const { batches, batchCountByLang: _batchCountByLang } = createBatches(missingKeysByLang);
    const stateManager = new StateManager(i18nDir);
    const enKeys = Object.keys(enData);
    const translatedResults: Record<string, Record<string, string>> = {};
    const completedLanguages: string[] = [];
    const langDataCache: Record<string, Record<string, string> | null> = {};

    for (let i = 0; i < batches.length; i += translationCfg.concurrentLimit) {
      if (cancellationSource.token.isCancellationRequested) {
        outputChannel.appendLine('[Auto-Sync] Cancelled');
        break;
      }

      const chunk = batches.slice(i, i + translationCfg.concurrentLimit);

      await Promise.all(
        chunk.map(async job => {
          const keyCount = Object.keys(job.batch).length;
          outputChannel.appendLine(
            `  [Auto-Sync] [${job.lang.toUpperCase()}] Translating ${keyCount} key(s)...`
          );

          // Lazy-load language data with short-locale fallback for context.
          if (!(job.lang in langDataCache)) {
            const loaded = loadLangContextWithFallback(config, job.lang);
            langDataCache[job.lang] = loaded.data;
            if (loaded.fellBackTo) {
              outputChannel.appendLine(
                `  [Auto-Sync] [${job.lang.toUpperCase()}] Using ${loaded.fellBackTo.toUpperCase()} as context fallback`
              );
            }
          }

          const result = await translateKeyBatch(
            job.batch,
            job.lang,
            job.id,
            outputChannel,
            cancellationSource!.token,
            enData,
            langDataCache[job.lang]
          );

          if (!translatedResults[job.lang]) {
            translatedResults[job.lang] = {};
          }
          Object.assign(translatedResults[job.lang], result.data);

          // Eagerly merge when all keys for a language are translated
          const completedForLang = Object.keys(translatedResults[job.lang]).length;
          const totalForLang = Object.keys(missingKeysByLang[job.lang]).length;

          if (completedForLang >= totalForLang && !completedLanguages.includes(job.lang)) {
            const added = mergeSingleLanguage(config, job.lang, translatedResults[job.lang], enKeys);
            outputChannel.appendLine(
              `  [Auto-Sync] [${job.lang.toUpperCase()}] Merged ${added} new key(s) into ${path.basename(config.getLangFilePath(job.lang))}`
            );
            completedLanguages.push(job.lang);
          }
        })
      );
    }

    // Merge any stragglers
    for (const lang of Object.keys(translatedResults)) {
      if (!completedLanguages.includes(lang)) {
        const added = mergeSingleLanguage(config, lang, translatedResults[lang], enKeys);
        if (added > 0) {
          outputChannel.appendLine(
            `  [Auto-Sync] [${lang.toUpperCase()}] Merged ${added} new key(s)`
          );
        }
      }
    }

    stateManager.cleanup();

    const totalAdded = Object.values(translatedResults).reduce(
      (sum, data) => sum + Object.keys(data).length,
      0
    );

    outputChannel.appendLine(`[Auto-Sync] Done - added ${totalAdded} translation(s)`);
    updateStatusBarAutoSync('done', totalAdded);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[Auto-Sync] Error: ${msg}`);
    updateStatusBarAutoSync('error');
  } finally {
    isRunning = false;
    cancellationSource?.dispose();
    cancellationSource = undefined;
  }
}

// ---------------------------------------------------------------------------
// Auto-sync status bar
// ---------------------------------------------------------------------------

function updateStatusBarAutoSync(state: 'running' | 'done' | 'error', count?: number): void {
  switch (state) {
    case 'running':
      statusBarItem.text = '$(sync~spin) i18n Auto-Syncing...';
      statusBarItem.tooltip = 'Background translation sync in progress';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBarItem.show();
      break;
    case 'done':
      statusBarItem.text = `$(check) i18n Auto-Synced (+${count || 0})`;
      statusBarItem.tooltip = `Auto-sync complete: added ${count || 0} translation(s)`;
      statusBarItem.backgroundColor = undefined;
      statusBarItem.show();
      setTimeout(() => {
        statusBarItem.text = '$(globe) i18n Sync';
        statusBarItem.tooltip = 'Click to sync missing translations';
      }, 8000);
      break;
    case 'error':
      statusBarItem.text = '$(error) i18n Auto-Sync Failed';
      statusBarItem.tooltip = 'Background sync failed - check output channel';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      statusBarItem.show();
      setTimeout(() => {
        statusBarItem.text = '$(globe) i18n Sync';
        statusBarItem.tooltip = 'Click to sync missing translations';
        statusBarItem.backgroundColor = undefined;
      }, 8000);
      break;
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function disposeWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  if (cancellationSource) {
    cancellationSource.cancel();
    cancellationSource.dispose();
    cancellationSource = undefined;
  }
  if (watcher) {
    watcher.dispose();
    watcher = undefined;
  }
  isRunning = false;
}
