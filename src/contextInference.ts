import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Contextual information for a single translation key. */
export interface KeyContext {
  /** The translation key to be translated. */
  key: string;
  /** The English source value. */
  value: string;
  /** Already-translated sibling keys that appear before this key. */
  contextBefore: { key: string; value: string }[];
  /** Already-translated sibling keys that appear after this key. */
  contextAfter: { key: string; value: string }[];
  /** Dot-separated prefix (e.g. `"settings.agreements"` for `"settings.agreements.title"`). */
  prefix: string;
}

/** A batch of keys enriched with their surrounding context. */
export interface BatchWithContext {
  keysToTranslate: Record<string, string>;
  context: KeyContext[];
}

// ---------------------------------------------------------------------------
// Key prefix utilities
// ---------------------------------------------------------------------------

/** Extracts the prefix (all parts except the last) of a dot-separated key. */
function getKeyPrefix(key: string): string {
  const parts = key.split('.');
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('.');
}

/**
 * Finds the N nearest sibling keys (same prefix) before and after `targetKey`
 * in the ordered key list.
 */
function getSiblingKeys(
  targetKey: string,
  allKeys: string[],
  allData: Record<string, string>,
  windowSize: number
): { before: { key: string; value: string }[]; after: { key: string; value: string }[] } {
  const targetIndex = allKeys.indexOf(targetKey);
  if (targetIndex === -1) {
    return { before: [], after: [] };
  }

  const prefix = getKeyPrefix(targetKey);

  const before: { key: string; value: string }[] = [];
  let count = 0;
  for (let i = targetIndex - 1; i >= 0 && count < windowSize; i--) {
    const k = allKeys[i];
    if (!prefix || getKeyPrefix(k) === prefix) {
      before.unshift({ key: k, value: allData[k] });
      count++;
    }
  }

  const after: { key: string; value: string }[] = [];
  count = 0;
  for (let i = targetIndex + 1; i < allKeys.length && count < windowSize; i++) {
    const k = allKeys[i];
    if (!prefix || getKeyPrefix(k) === prefix) {
      after.push({ key: k, value: allData[k] });
      count++;
    }
  }

  return { before, after };
}

// ---------------------------------------------------------------------------
// Batch enrichment
// ---------------------------------------------------------------------------

/**
 * Enriches a flat batch of key/value pairs with contextual sibling keys
 * from the English source and the existing target-language file.
 *
 * This context helps the LLM produce translations consistent with the
 * surrounding domain vocabulary.
 */
export function enrichBatchWithContext(
  batch: Record<string, string>,
  enData: Record<string, string>,
  existingLangData: Record<string, string> | null
): BatchWithContext {
  const cfg = vscode.workspace.getConfiguration('i18nSync');
  const windowSize = cfg.get<number>('contextWindowSize', 5);

  const batchKeys = Object.keys(batch);

  if (windowSize === 0) {
    return {
      keysToTranslate: batch,
      context: batchKeys.map(key => ({
        key,
        value: batch[key],
        contextBefore: [],
        contextAfter: [],
        prefix: getKeyPrefix(key),
      })),
    };
  }

  const allEnKeys = Object.keys(enData);
  const batchKeySet = new Set(batchKeys);
  const contextEntries: KeyContext[] = [];

  for (const key of batchKeys) {
    const { before, after } = getSiblingKeys(key, allEnKeys, enData, windowSize);

    // Use existing translations for context when available; fall back to English
    const contextBefore = before
      .filter(item => !batchKeySet.has(item.key))
      .map(item => ({
        key: item.key,
        value: existingLangData?.[item.key] || item.value,
      }));

    const contextAfter = after
      .filter(item => !batchKeySet.has(item.key))
      .map(item => ({
        key: item.key,
        value: existingLangData?.[item.key] || item.value,
      }));

    contextEntries.push({
      key,
      value: batch[key],
      contextBefore,
      contextAfter,
      prefix: getKeyPrefix(key),
    });
  }

  return {
    keysToTranslate: batch,
    context: contextEntries,
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds a YAML-structured prompt string that instructs the LLM to translate
 * a batch of keys, grouped by prefix, with context comments.
 */
export function buildYamlPrompt(
  batchWithContext: BatchWithContext,
  targetLang: string,
  translationTone: string
): string {
  const { context } = batchWithContext;

  // Group context entries by key prefix for cleaner prompt sections
  const groupedByPrefix = new Map<string, KeyContext[]>();
  for (const entry of context) {
    const prefix = entry.prefix || '__root__';
    if (!groupedByPrefix.has(prefix)) {
      groupedByPrefix.set(prefix, []);
    }
    groupedByPrefix.get(prefix)!.push(entry);
  }

  let yamlBody = '';
  let itemIndex = 1;

  for (const [prefix, entries] of groupedByPrefix) {
    const sectionLabel = prefix === '__root__' ? 'General' : prefix;
    yamlBody += `# --- Section: ${sectionLabel} ---\n`;

    // Collect de-duplicated context lines
    const beforeLines = new Set<string>();
    const afterLines = new Set<string>();
    for (const entry of entries) {
      for (const ctx of entry.contextBefore) {
        beforeLines.add(`${ctx.key}: ${ctx.value}`);
      }
      for (const ctx of entry.contextAfter) {
        afterLines.add(`${ctx.key}: ${ctx.value}`);
      }
    }

    if (beforeLines.size > 0 || afterLines.size > 0) {
      yamlBody += `# Context (already translated siblings for reference, DO NOT translate these):\n`;
      for (const line of beforeLines) {
        yamlBody += `#   ${line}\n`;
      }
      if (afterLines.size > 0) {
        yamlBody += `#   ...\n`;
        for (const line of afterLines) {
          yamlBody += `#   ${line}\n`;
        }
      }
      yamlBody += `#\n`;
    }

    yamlBody += `# Translate the following:\n`;
    for (const entry of entries) {
      yamlBody += `${itemIndex}. ${entry.key}: "${entry.value}"\n`;
      itemIndex++;
    }
    yamlBody += `\n`;
  }

  return [
    'IMPORTANT: Do NOT use any tools, do NOT modify any files, do NOT read any files. Only respond with plain text output.',
    '',
    `Translate the English strings below to ${targetLang}. Use a ${translationTone} tone.`,
    '',
    'Rules:',
    '- Preserve HTML tags, placeholders like {{variable}} or {variable}, and technical/brand terms',
    '- Use the commented context lines (prefixed with #) to understand the domain and tone, but do NOT translate them',
    '- Return ONLY the translated values in the exact same numbered format: "N. translated value"',
    '- No extra explanation, no markdown, no YAML structure in the output',
    '',
    yamlBody,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Key order extraction
// ---------------------------------------------------------------------------

/**
 * Returns the ordered list of keys-to-translate from a `BatchWithContext`,
 * matching the numbered order that appears in the prompt. This is used
 * to map the LLM's numbered responses back to the correct keys.
 */
export function getKeyOrderFromContext(batchWithContext: BatchWithContext): string[] {
  const groupedByPrefix = new Map<string, KeyContext[]>();

  for (const entry of batchWithContext.context) {
    const prefix = entry.prefix || '__root__';
    if (!groupedByPrefix.has(prefix)) {
      groupedByPrefix.set(prefix, []);
    }
    groupedByPrefix.get(prefix)!.push(entry);
  }

  const keyOrder: string[] = [];
  for (const [, entries] of groupedByPrefix) {
    for (const entry of entries) {
      keyOrder.push(entry.key);
    }
  }

  return keyOrder;
}
