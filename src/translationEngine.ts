import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';
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
  cliTimeoutSeconds: number;
  debugMode: boolean;
}

/** Reads extension settings into a typed config object. */
export function getConfig(): TranslationConfig {
  const cfg = vscode.workspace.getConfiguration('i18nSync');
  return {
    model: cfg.get<string>('model', ''),
    contextWindowSize: cfg.get<number>('contextWindowSize', 5),
    batchSize: cfg.get<number>('batchSize', 40),
    concurrentLimit: cfg.get<number>('concurrentLimit', 3),
    maxRetries: cfg.get<number>('maxRetries', 3),
    translationTone: cfg.get<string>('translationTone', 'formal business'),
    cursorCliPath: cfg.get<string>('cursorCliPath', 'auto'),
    cliTimeoutSeconds: cfg.get<number>('cliTimeoutSeconds', 180),
    debugMode: cfg.get<boolean>('debugMode', false),
  };
}

// ---------------------------------------------------------------------------
// CLI command resolution (auto-detect `agent` vs legacy `cursor`)
// ---------------------------------------------------------------------------

/**
 * Cursor renamed the CLI binary from `cursor` to `agent` in 2026.
 *
 *   Old CLI: `cursor agent --print --force --output-format text ...`
 *   New CLI: `agent --print --force --output-format text ...`
 *
 * The new binary does NOT take an `agent` subcommand — the binary itself
 * is the agent. We support both:
 *
 *   - `command`             — the executable to spawn
 *   - `useAgentSubcommand`  — whether to prepend `agent` as the first arg
 *                              (true for the legacy `cursor` binary, false
 *                              for the new `agent` binary)
 */
export interface ResolvedCli {
  command: string;
  useAgentSubcommand: boolean;
  source: 'configured' | 'auto-detected-agent' | 'auto-detected-cursor' | 'fallback';
}

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Cache the probe result so we don't shell out to `--version` for every
 * batch. Keyed by the configured value so changes to the setting take
 * effect on the next sync.
 */
const cliResolutionCache = new Map<string, ResolvedCli>();

/** Public hook used by tests / settings change listeners to drop the cache. */
export function clearCliResolutionCache(): void {
  cliResolutionCache.clear();
}

function probeCommand(cmd: string): boolean {
  try {
    const result = spawnSync(cmd, ['--version'], {
      stdio: 'ignore',
      timeout: PROBE_TIMEOUT_MS,
    });
    return result.status === 0 && !result.error;
  } catch {
    return false;
  }
}

/**
 * Decides whether a custom path/command should be invoked with the
 * `agent` subcommand. Heuristic: if the basename is `agent` (the new
 * standalone binary) we skip it; otherwise we assume the legacy
 * `cursor` style.
 */
function inferUseAgentSubcommand(cmd: string): boolean {
  const base = path.basename(cmd).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  return base !== 'agent';
}

/**
 * Resolves the CLI command to invoke based on the configured
 * `cursorCliPath` setting. Supports:
 *
 *   - `auto`    — probe `agent` first, fall back to `cursor`.
 *   - `agent`   — new standalone CLI (no subcommand).
 *   - `cursor`  — legacy CLI (uses `agent` subcommand).
 *   - any other path — basename decides which mode to use.
 */
export function resolveCliCommand(configuredPath: string): ResolvedCli {
  const cached = cliResolutionCache.get(configuredPath);
  if (cached) {
    return cached;
  }

  let resolved: ResolvedCli;

  if (configuredPath === 'auto') {
    if (probeCommand('agent')) {
      resolved = { command: 'agent', useAgentSubcommand: false, source: 'auto-detected-agent' };
    } else if (probeCommand('cursor')) {
      resolved = { command: 'cursor', useAgentSubcommand: true, source: 'auto-detected-cursor' };
    } else {
      // Neither is on PATH — fall back to `agent` so the spawn error
      // reflects the new binary name (which is what the user is most
      // likely missing on a fresh install).
      resolved = { command: 'agent', useAgentSubcommand: false, source: 'fallback' };
    }
  } else {
    resolved = {
      command: configuredPath,
      useAgentSubcommand: inferUseAgentSubcommand(configuredPath),
      source: 'configured',
    };
  }

  cliResolutionCache.set(configuredPath, resolved);
  return resolved;
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
    return 'Cursor CLI path is empty. Set i18nSync.cursorCliPath in settings (use "auto", "agent", "cursor", or an absolute path).';
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

  if (
    errorMessage.includes('spawn agent ENOENT') ||
    errorMessage.includes('spawn cursor ENOENT') ||
    errorMessage.includes('ENOENT')
  ) {
    return "Cursor CLI not found. Install it with `curl https://cursor.com/install -fsSL | bash`, ensure 'agent' (or legacy 'cursor') is in your PATH, or set i18nSync.cursorCliPath in settings.";
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

function buildCliArgs(cfg: TranslationConfig, cli: ResolvedCli, prompt: string): string[] {
  const args: string[] = [];
  if (cli.useAgentSubcommand) {
    args.push('agent');
  }
  args.push('--print', '--force', '--output-format', 'text');
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
  type: 'cancelled' | 'fatal_limit' | 'rate_limit' | 'retryable_error' | 'bad_response' | 'timeout' | 'error';
  message: string;
  response?: string;
}

// ---------------------------------------------------------------------------
// Core translation
// ---------------------------------------------------------------------------

const INITIAL_BACKOFF_MS = 2_000;
const HEARTBEAT_MS = 15_000;
const SLOW_FIRST_BYTE_MS = 30_000;
const STREAM_CHUNK_PREVIEW_CHARS = 200;
const TIMEOUT_DUMP_CHARS = 1_000;

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

  const cli = resolveCliCommand(cfg.cursorCliPath);
  if (cfg.debugMode) {
    output.appendLine(
      `[DEBUG] Batch ${batchId} CLI resolved: command=${cli.command}, useAgentSubcommand=${cli.useAgentSubcommand} (source=${cli.source})`
    );
  }

  const batchWithContext = enrichBatchWithContext(batch, enData, existingLangData);
  const prompt = buildYamlPrompt(batchWithContext, targetLang, cfg.translationTone);
  const keyOrder = getKeyOrderFromContext(batchWithContext);

  if (cfg.debugMode) {
    const stats = getPromptStats(prompt);
    output.appendLine(
      `[DEBUG] Batch ${batchId} prompt stats: chars=${stats.chars}, lines=${stats.lines}, contextLines=${stats.contextLines}, items=${stats.items}, maxInputValueChars=${stats.maxInputValueChars}`
    );
    output.appendLine(`[DEBUG] Batch ${batchId} prompt (${prompt.length} chars):`);
    output.appendLine(prompt.split('\n').map(l => `  | ${l}`).join('\n'));
  }

  for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
    if (token.isCancellationRequested) {
      return { success: false, data: batch };
    }

    try {
      const result = await executeCli(
        { cfg, cli, prompt, keyOrder, batchId, targetLang },
        output,
        token
      );
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
        // Backoff is only useful when the upstream is asking us to slow down
        // (rate limit / transient internal error). For a CLI timeout the
        // batch already burned `cliTimeoutSeconds` of wall time waiting on
        // the backend; sleeping another 2-8s before retrying just adds
        // dead time. Same for `bad_response` — that's a model output
        // problem, not a throttling signal.
        const shouldBackoff = err.type === 'rate_limit' || err.type === 'retryable_error';
        if (shouldBackoff) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          output.appendLine(`    Backing off ${backoff / 1000}s before retry (reason: ${err.type})...`);
          await delay(backoff);
        } else {
          output.appendLine(`    Retrying immediately (reason: ${err.type}, no backoff needed)...`);
        }
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
 *
 * Logging behaviour:
 *
 *   - Always logs accumulated stdout/stderr on timeout. This is the single
 *     most useful diagnostic when the CLI hangs (auth prompts, network
 *     stalls, etc.) and is cheap enough to do unconditionally.
 *   - With `debugMode` on, additionally streams stdout/stderr chunks live,
 *     emits a heartbeat every 15s, and logs the resolved command + PID +
 *     elapsed time. This makes it trivial to tell whether the CLI is
 *     producing any output at all vs. waiting on something.
 */
interface ExecuteCliRequest {
  cfg: TranslationConfig;
  cli: ResolvedCli;
  prompt: string;
  keyOrder: string[];
  batchId: number;
  targetLang: string;
}

function executeCli(
  req: ExecuteCliRequest,
  output: vscode.OutputChannel,
  token: vscode.CancellationToken
): Promise<Record<string, string>> {
  const { cfg, cli, prompt, keyOrder, batchId, targetLang } = req;
  return new Promise<Record<string, string>>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let firstStdoutAt: number | null = null;
    let firstStderrAt: number | null = null;
    let lastOutputAt: number | null = null;
    let slowFirstByteLogged = false;

    const tag = `[Batch ${batchId} | ${targetLang.toUpperCase()}]`;
    const debugTag = `[DEBUG] ${tag}`;
    const cliArgs = buildCliArgs(cfg, cli, prompt);
    const startedAt = Date.now();
    const timeoutMs = Math.max(10, cfg.cliTimeoutSeconds) * 1_000;

    if (cfg.debugMode) {
      // Print the full argv (with the prompt redacted as `<prompt:Nchars>`
      // since it can be huge), so the user can reproduce the exact call.
      const argvForLog = cliArgs
        .slice(0, -1)
        .concat(`<prompt:${prompt.length}chars>`)
        .map(a => (a.includes(' ') ? JSON.stringify(a) : a))
        .join(' ');
      output.appendLine(
        `${debugTag} spawning: ${cli.command} ${argvForLog}  (timeout=${timeoutMs / 1000}s)`
      );
      output.appendLine(
        `${debugTag} env: cwd=${process.cwd()}, pathEntries=${(process.env.PATH || '').split(':').filter(Boolean).length}`
      );
    }

    const child = spawn(cli.command, cliArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (cfg.debugMode) {
      output.appendLine(`${debugTag} pid=${child.pid ?? '?'}`);
    }

    const heartbeat = cfg.debugMode
      ? setInterval(() => {
          const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
          const lastOutputAgeSec =
            lastOutputAt === null ? 'never' : `${Math.round((Date.now() - lastOutputAt) / 1000)}s ago`;
          output.appendLine(
            `${debugTag} still running after ${elapsedSec}s (stdout=${stdout.length}b, stderr=${stderr.length}b, firstStdout=${formatElapsed(firstStdoutAt, startedAt)}, firstStderr=${formatElapsed(firstStderrAt, startedAt)}, lastOutput=${lastOutputAgeSec}, pid=${child.pid ?? '?'})`
          );
          if (!slowFirstByteLogged && firstStdoutAt === null && firstStderrAt === null && Date.now() - startedAt >= SLOW_FIRST_BYTE_MS) {
            slowFirstByteLogged = true;
            output.appendLine(
              `${debugTag} slow start: no stdout/stderr after ${Math.round(SLOW_FIRST_BYTE_MS / 1000)}s. This usually points to Cursor CLI/model queue latency rather than prompt parsing.`
            );
          }
        }, HEARTBEAT_MS)
      : null;

    const cleanup = (): void => {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      child.kill();
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

      // Always dump partial output on timeout — this is the killer diagnostic
      // for a hung CLI (auth prompt waiting on stdin, network stall, etc.)
      // and a 90s+ hang has earned a few KB of log noise.
      output.appendLine(`${tag} CLI timed out after ${elapsedSec}s. Dumping partial output for diagnosis:`);
      output.appendLine(`${tag}   command: ${cli.command} ${cliArgs.slice(0, -1).join(' ')} <prompt:${prompt.length}chars>`);
      output.appendLine(`${tag}   pid: ${child.pid ?? '?'}`);
      output.appendLine(`${tag}   stdout (${stdout.length}b): ${truncate(stdout, TIMEOUT_DUMP_CHARS) || '<empty>'}`);
      output.appendLine(`${tag}   stderr (${stderr.length}b): ${truncate(stderr, TIMEOUT_DUMP_CHARS) || '<empty>'}`);
      if (!stdout && !stderr) {
        output.appendLine(
          `${tag}   Hint: zero output usually means the CLI is waiting on auth (run \`${cli.command} login\`) or network. Enable i18nSync.debugMode for live streaming.`
        );
      }

      reject({
        type: 'timeout',
        message: `Command timeout after ${elapsedSec}s (stdout=${stdout.length}b, stderr=${stderr.length}b). See output channel for partial data.`,
      } as CliError);
    }, timeoutMs);

    let cancelListener: vscode.Disposable | null = null;
    const rejectAsCancelled = (): void => {
      cleanup();
      clearTimeout(timeout);
      cancelListener?.dispose();
      child.kill();
      reject({ type: 'cancelled', message: 'Cancelled by user' } as CliError);
    };

    if (token.isCancellationRequested) {
      rejectAsCancelled();
      return;
    }

    cancelListener = token.onCancellationRequested(rejectAsCancelled);

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      const now = Date.now();
      firstStdoutAt ??= now;
      lastOutputAt = now;
      stdout += chunk;
      if (cfg.debugMode) {
        output.appendLine(
          `${debugTag} stdout +${chunk.length}b at ${formatElapsed(firstStdoutAt, startedAt)}: ${previewChunk(chunk)}`
        );
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      const now = Date.now();
      firstStderrAt ??= now;
      lastOutputAt = now;
      stderr += chunk;
      if (cfg.debugMode) {
        output.appendLine(
          `${debugTag} stderr +${chunk.length}b at ${formatElapsed(firstStderrAt, startedAt)}: ${previewChunk(chunk)}`
        );
      }
    });

    child.on('error', (err: Error) => {
      cleanup();
      clearTimeout(timeout);
      cancelListener?.dispose();
      // ENOENT, EACCES, etc. — surface them clearly so users see exactly
      // which binary is missing (parseCursorError already handles ENOENT).
      output.appendLine(`${tag} spawn error: ${err.message}`);
      reject({ type: 'error', message: parseCursorError(err.message) } as CliError);
    });

    child.on('close', (code: number | null) => {
      cleanup();
      clearTimeout(timeout);
      cancelListener?.dispose();

      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

      if (cfg.debugMode) {
        output.appendLine(
          `${debugTag} process closed after ${elapsedSec}s: code=${code}, stdout=${stdout.length}b, stderr=${stderr.length}b, firstStdout=${formatElapsed(firstStdoutAt, startedAt)}, firstStderr=${formatElapsed(firstStderrAt, startedAt)}`
        );
        if (stdout) {
          output.appendLine(`${debugTag} full stdout: ${truncate(stdout, 1500)}`);
        }
        if (stderr) {
          output.appendLine(`${debugTag} full stderr: ${truncate(stderr, 1500)}`);
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

interface PromptStats {
  chars: number;
  lines: number;
  contextLines: number;
  items: number;
  maxInputValueChars: number;
}

function getPromptStats(prompt: string): PromptStats {
  const lines = prompt.split('\n');
  let items = 0;
  let maxInputValueChars = 0;
  for (const line of lines) {
    const itemMatch = line.match(/^\d+\.\s+"(.*)"$/);
    if (itemMatch) {
      items++;
      maxInputValueChars = Math.max(maxInputValueChars, itemMatch[1].length);
    }
  }
  return {
    chars: prompt.length,
    lines: lines.length,
    contextLines: lines.filter(line => line.startsWith('#')).length,
    items,
    maxInputValueChars,
  };
}

function formatElapsed(timestamp: number | null, startedAt: number): string {
  return timestamp === null ? 'never' : `${((timestamp - startedAt) / 1000).toFixed(1)}s`;
}

/** Single-line preview of a stream chunk for live debug logging. */
function previewChunk(chunk: string): string {
  const flat = chunk.replaceAll(/\r?\n/g, '\\n');
  return flat.length > STREAM_CHUNK_PREVIEW_CHARS
    ? `${flat.slice(0, STREAM_CHUNK_PREVIEW_CHARS)}…(+${flat.length - STREAM_CHUNK_PREVIEW_CHARS} more)`
    : flat;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}…(+${s.length - max} more chars)`;
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
 * Defensive cleanup of a raw model response line (after the leading
 * `N. ` numbering prefix has already been stripped by the parser).
 *
 * Two artifacts are normalised:
 *
 * 1. **Echoed key prefix.** Older prompt revisions sent each item as
 *    `N. key: "value"`, which Gemini variants in particular liked to
 *    mirror back as `N. key: "translation"`. Current prompts no longer
 *    include the key on the to-translate line (see contextInference
 *    `buildYamlPrompt`), but we keep the strip logic as defence-in-depth
 *    in case a future prompt regression or an unusual model echoes the
 *    key anyway.
 *
 * 2. **Surrounding quotes.** The English value is wrapped in double
 *    quotes in the prompt so the model can unambiguously see where it
 *    starts and ends. Many models mirror those quotes back; we always
 *    try to unwrap a matching `"..."` / `'...'` pair so the saved file
 *    contains the bare translated text.
 *
 * `unwrapMatchingQuotes` is conservative — it only strips when the first
 * and last characters are the same quote char, so values that legitimately
 * start *or* end (but not both) with a quote are preserved.
 */
export function sanitizeTranslatedValue(rawValue: string, key: string): string {
  let value = rawValue;

  const keyEcho = new RegExp(String.raw`^${escapeRegExp(key)}\s*:\s*`);
  if (keyEcho.test(value)) {
    value = value.replace(keyEcho, '');
  }

  value = unwrapMatchingQuotes(value);

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
