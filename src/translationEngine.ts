import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { enrichBatchWithContext, buildYamlPrompt, getKeyOrderFromContext } from './contextInference';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TranslationResult {
  success: boolean;
  data: Record<string, string>;
}

export interface TranslationBatch {
  id: number;
  lang: string;
  batch: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TranslationConfig {
  model: string;
  contextWindowSize: number;
  batchSize: number;
  concurrentLimit: number;
  maxRetries: number;
  translationTone: string;
  cursorCliPath: string;
  debugMode: boolean;
}

/** Reads extension settings into a typed config object. */
export function getConfig(): TranslationConfig {
  const cfg = vscode.workspace.getConfiguration('i18nSync');
  return {
    model: cfg.get<string>('model', ''),
    contextWindowSize: cfg.get<number>('contextWindowSize', 5),
    batchSize: cfg.get<number>('batchSize', 40),
    concurrentLimit: cfg.get<number>('concurrentLimit', 2),
    maxRetries: cfg.get<number>('maxRetries', 3),
    translationTone: cfg.get<string>('translationTone', 'formal business'),
    cursorCliPath: cfg.get<string>('cursorCliPath', 'cursor'),
    debugMode: cfg.get<boolean>('debugMode', false),
  };
}

// ---------------------------------------------------------------------------
// CLI path validation (security)
// ---------------------------------------------------------------------------

/**
 * Characters that must not appear in the CLI path. While `spawn` does not
 * invoke a shell, allowing metacharacters could still be confusing or lead
 * to unexpected behaviour on certain platforms.
 */
const DANGEROUS_PATH_CHARS = /[;&|`$(){}[\]!<>"']/;

/**
 * Validates that the configured CLI path looks safe to execute.
 * Returns an error message if invalid, or `null` if OK.
 */
function validateCliPath(cliPath: string): string | null {
  if (!cliPath || cliPath.trim().length === 0) {
    return 'Cursor CLI path is empty. Set i18nSync.cursorCliPath in settings.';
  }
  if (DANGEROUS_PATH_CHARS.test(cliPath)) {
    return `Cursor CLI path contains invalid characters: "${cliPath}". Only alphanumeric characters, hyphens, underscores, dots, and path separators are allowed.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Error parsing
// ---------------------------------------------------------------------------

/** Extracts a human-readable message from raw Cursor CLI stderr output. */
function parseCursorError(errorMessage: string): string {
  if (!errorMessage) {
    return 'No error message provided.';
  }

  if (errorMessage.includes('spawn cursor ENOENT') || errorMessage.includes('ENOENT')) {
    return "Cursor CLI not found. Ensure 'cursor' is in your PATH, or set i18nSync.cursorCliPath in settings.";
  }

  const quotaMatch = errorMessage.match(
    /Quota exceeded for quota metric '([^']+)' and limit '([^']+)'/
  );
  if (quotaMatch) {
    return `Quota exceeded for metric '${quotaMatch[1]}' and limit '${quotaMatch[2]}'`;
  }

  const messageMatch = errorMessage.match(/"message":\s*"([^"]+)"/);
  if (messageMatch?.[1]) {
    return messageMatch[1];
  }

  const reasonMatch = errorMessage.match(/"reason":\s*"([^"]+)"/);
  if (reasonMatch) {
    return `Error reason: ${reasonMatch[1]}`;
  }

  // Truncate long messages to avoid flooding the output channel
  const MAX_ERROR_LENGTH = 300;
  return errorMessage.length > MAX_ERROR_LENGTH
    ? errorMessage.substring(0, MAX_ERROR_LENGTH) + '...'
    : errorMessage;
}

// ---------------------------------------------------------------------------
// CLI argument builder
// ---------------------------------------------------------------------------

function buildCliArgs(cfg: TranslationConfig, prompt: string): string[] {
  const args = ['agent', '--print', '--force', '--output-format', 'text'];
  if (cfg.model) {
    args.push('--model', cfg.model);
  }
  args.push(prompt);
  return args;
}

// ---------------------------------------------------------------------------
// Structured error for internal retry logic
// ---------------------------------------------------------------------------

interface CliError {
  type: 'cancelled' | 'fatal_limit' | 'rate_limit' | 'retryable_error' | 'bad_response' | 'error';
  message: string;
  response?: string;
}

// ---------------------------------------------------------------------------
// Core translation
// ---------------------------------------------------------------------------

const CLI_TIMEOUT_MS = 90_000;
const INITIAL_BACKOFF_MS = 2_000;

/**
 * Translates a batch of English key/value pairs into `targetLang` via the
 * Cursor CLI. Includes exponential-backoff retries and cancellation support.
 */
export async function translateKeyBatch(
  batch: Record<string, string>,
  targetLang: string,
  batchId: number,
  output: vscode.OutputChannel,
  token: vscode.CancellationToken,
  enData: Record<string, string>,
  existingLangData: Record<string, string> | null
): Promise<TranslationResult> {
  const cfg = getConfig();

  // Security: validate CLI path before spawning
  const pathError = validateCliPath(cfg.cursorCliPath);
  if (pathError) {
    output.appendLine(`  [Batch ${batchId} | ${targetLang}] ${pathError}`);
    vscode.window.showErrorMessage(`i18n Sync: ${pathError}`);
    return { success: false, data: batch };
  }

  const batchWithContext = enrichBatchWithContext(batch, enData, existingLangData);
  const prompt = buildYamlPrompt(batchWithContext, targetLang, cfg.translationTone);
  const keyOrder = getKeyOrderFromContext(batchWithContext);

  if (cfg.debugMode) {
    output.appendLine(`[DEBUG] Batch ${batchId} prompt (${prompt.length} chars):`);
    output.appendLine(prompt.split('\n').map(l => `  | ${l}`).join('\n'));
  }

  for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
    if (token.isCancellationRequested) {
      return { success: false, data: batch };
    }

    try {
      const result = await executeCli(cfg, prompt, keyOrder, batchId, output, token);
      return { success: true, data: result };
    } catch (error: unknown) {
      const err = error as CliError;

      output.appendLine(
        `  [Batch ${batchId} | ${targetLang}] Attempt ${attempt}/${cfg.maxRetries} failed: ${err.message || 'Unknown error'}`
      );

      if (err.type === 'cancelled') {
        return { success: false, data: batch };
      }

      if (err.type === 'fatal_limit') {
        vscode.window.showErrorMessage(`i18n Sync: API quota limit reached. ${err.message}`);
        return { success: false, data: batch };
      }

      if (err.type === 'bad_response' && cfg.debugMode) {
        output.appendLine(`    Raw response: ${err.response?.substring(0, 500)}`);
      }

      if (attempt < cfg.maxRetries) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        output.appendLine(`    Retrying in ${backoff / 1000}s...`);
        await delay(backoff);
      } else {
        output.appendLine(
          `  [Batch ${batchId} | ${targetLang}] Failed after ${cfg.maxRetries} attempts. Skipping.`
        );
        return { success: false, data: batch };
      }
    }
  }

  // Unreachable in practice, but satisfies TypeScript
  return { success: false, data: batch };
}

/**
 * Spawns the Cursor CLI process and parses the numbered-list output.
 * Rejects with a structured `CliError` on any failure.
 */
function executeCli(
  cfg: TranslationConfig,
  prompt: string,
  keyOrder: string[],
  batchId: number,
  output: vscode.OutputChannel,
  token: vscode.CancellationToken
): Promise<Record<string, string>> {
  return new Promise<Record<string, string>>((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const cliArgs = buildCliArgs(cfg, prompt);
    const child = spawn(cfg.cursorCliPath, cliArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject({ type: 'error', message: `Command timeout after ${CLI_TIMEOUT_MS / 1000} seconds` } as CliError);
    }, CLI_TIMEOUT_MS);

    if (token.isCancellationRequested) {
      clearTimeout(timeout);
      child.kill();
      reject({ type: 'cancelled', message: 'Cancelled by user' } as CliError);
      return;
    }

    const cancelListener = token.onCancellationRequested(() => {
      clearTimeout(timeout);
      child.kill();
      reject({ type: 'cancelled', message: 'Cancelled by user' } as CliError);
    });

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      cancelListener.dispose();

      if (cfg.debugMode) {
        output.appendLine(
          `[DEBUG] Batch ${batchId} CLI Response: code=${code}, stdout=${stdout.length}b, stderr=${stderr.length}b`
        );
        if (stdout) {
          output.appendLine(`[DEBUG] stdout: ${stdout.substring(0, 500)}`);
        }
      }

      const cliError = classifyCliError(stderr, code);
      if (cliError) {
        return reject(cliError);
      }

      const translatedValues = stdout
        .split(/\r?\n/)
        .map(line => {
          const match = line.match(/^\d+\.\s*(.*)/);
          return match ? match[1] : null;
        })
        .filter((v): v is string => v !== null);

      if (translatedValues.length !== keyOrder.length) {
        return reject({
          type: 'bad_response',
          message: `Expected ${keyOrder.length} translated strings, got ${translatedValues.length}.`,
          response: stdout,
        } as CliError);
      }

      const translatedBatch: Record<string, string> = {};
      for (let i = 0; i < keyOrder.length; i++) {
        const key = keyOrder[i];
        translatedBatch[key] = sanitizeTranslatedValue(translatedValues[i], key);
      }

      resolve(translatedBatch);
    });
  });
}

/**
 * Examines CLI stderr/exit-code and returns a typed error if a problem
 * is detected, or `null` if the invocation succeeded.
 */
function classifyCliError(stderr: string, exitCode: number | null): CliError | null {
  const lowerStderr = stderr.toLowerCase();

  const hasQuotaIssue = lowerStderr.includes('quota exceeded');
  const hasRateLimit = lowerStderr.includes('rate limit') || lowerStderr.includes('ratelimitexceeded');
  const hasFileSystemError = stderr.includes('ENOENT') || stderr.includes('cli-config.json');

  if (hasQuotaIssue) {
    return { type: 'fatal_limit', message: parseCursorError(stderr) };
  }
  if (hasRateLimit) {
    return { type: 'rate_limit', message: parseCursorError(stderr) };
  }
  if (hasFileSystemError) {
    return { type: 'retryable_error', message: 'Cursor CLI internal file system error (retrying...)' };
  }
  if (exitCode !== 0) {
    return { type: 'error', message: parseCursorError(stderr || `Process exited with code ${exitCode}`) };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

/**
 * Splits missing keys per language into sized batches ready for concurrent
 * translation.
 */
export function createBatches(
  missingKeysByLang: Record<string, Record<string, string>>
): { batches: TranslationBatch[]; batchCountByLang: Record<string, number> } {
  const cfg = getConfig();
  const batches: TranslationBatch[] = [];
  const batchCountByLang: Record<string, number> = {};
  let batchIdCounter = 1;

  for (const lang of Object.keys(missingKeysByLang)) {
    const keys = Object.keys(missingKeysByLang[lang]);
    if (keys.length === 0) {
      continue;
    }

    batchCountByLang[lang] = 0;

    for (let i = 0; i < keys.length; i += cfg.batchSize) {
      const batchKeys = keys.slice(i, i + cfg.batchSize);
      const batchData: Record<string, string> = {};
      for (const key of batchKeys) {
        batchData[key] = missingKeysByLang[lang][key];
      }
      batches.push({ id: batchIdCounter++, lang, batch: batchData });
      batchCountByLang[lang]++;
    }
  }

  return { batches, batchCountByLang };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeRegExp(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * The prompt feeds each item to the LLM as `N. key: "value"`. Some models
 * (notably Gemini variants) occasionally mirror that exact format in their
 * reply instead of returning only the translated value, producing lines like
 * `N. key: "translated"`. After the leading `N. ` is stripped we may still
 * be left with `key: "translated"` (or even `key: translated`).
 *
 * This helper detects that pattern for a known target key and returns the
 * inner translated string, also unwrapping a single layer of surrounding
 * matching quotes and unescaping `\"` / `\\` if present.
 */
export function sanitizeTranslatedValue(rawValue: string, key: string): string {
  let value = rawValue;

  const keyEcho = new RegExp(String.raw`^${escapeRegExp(key)}\s*:\s*`);
  if (keyEcho.test(value)) {
    value = value.replace(keyEcho, '');
    value = unwrapMatchingQuotes(value);
  }

  return value;
}

/**
 * If `value` is wrapped in a matching pair of `"..."` or `'...'`, remove the
 * outer pair and unescape `\"`, `\'`, and `\\`. Leaves the string untouched
 * otherwise so values that legitimately start/end with quote characters are
 * preserved.
 */
function unwrapMatchingQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    const inner = value.slice(1, -1);
    return inner
      .replaceAll(String.raw`\"`, '"')
      .replaceAll(String.raw`\'`, "'")
      .replaceAll(String.raw`\\`, '\\');
  }
  return value;
}
