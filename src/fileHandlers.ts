import * as fs from 'fs';
import * as path from 'path';
import { I18N_JSON_FILE_REGEX, MESSAGES_PROPERTIES_FILE_REGEX } from './localeUtils';
import { flattenJson, unflattenJson } from './jsonNesting';

/**
 * Describes a detected i18n project layout (JSON or Java Properties).
 * All file I/O for a given format is encapsulated here so callers
 * do not need format-specific branching.
 */
export interface ProjectConfig {
  /** File format: `"json"` or `"properties"`. */
  mode: 'json' | 'properties';
  /** Absolute path to the English source file. */
  enFilePath: string;
  /** Base filename of the English source (e.g. `"i18n-en.json"`). */
  baseEnFileName: string;
  /** Regex that matches any language file in this format. */
  langFileRegex: RegExp;
  /** Extracts the language code from a matching filename. */
  getLang: (fileName: string) => string;
  /** Returns the absolute path for a given language code. */
  getLangFilePath: (lang: string) => string;
  /** Reads and parses a file, returning key/value pairs or `null` on failure. */
  readFile: (filePath: string) => Record<string, string> | null;
  /**
   * Merges new translations into an existing file, preserving key order
   * (JSON) or file structure (Properties).
   */
  mergeTranslations: (
    filePath: string,
    existingData: Record<string, string>,
    newTranslations: Record<string, string>,
    enKeys: string[]
  ) => void;
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

/**
 * Reads a JSON i18n file and returns a flat dotted-key map. Nested
 * objects in the file are transparently flattened so the rest of the
 * extension can keep treating translations as `Record<string, string>`.
 * Per-leaf shape information (which leaves came from nested objects vs
 * literal flat dotted keys) is recovered separately at write time via
 * {@link getJsonShape}. Returns `null` if the file is missing or invalid.
 */
export function readJson(filePath: string): Record<string, string> | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return flattenJson(parsed).flat;
  } catch {
    return null;
  }
}

/**
 * Returns the set of flat dotted keys whose value originated from a
 * nested object in the file (vs a literal top-level dotted string key).
 * Empty Set when the file is missing, invalid, or fully flat.
 *
 * Used at write time to reconstitute the per-leaf shape so a file that
 * mixes both styles round-trips losslessly. Cheap to call (a single
 * JSON parse + tree walk); not cached because i18n files are small and
 * the read happens at most a few times per sync.
 */
export function getJsonShape(filePath: string): Set<string> {
  try {
    if (!fs.existsSync(filePath)) {
      return new Set<string>();
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return flattenJson(parsed).nestedKeys;
  } catch {
    return new Set<string>();
  }
}

/**
 * Writes a flat dotted-key map as pretty-printed JSON. If `nestedKeys`
 * is provided, leaves in that set are reconstituted as nested objects;
 * leaves not in the set stay as literal flat dotted keys. Pass an empty
 * Set (or omit `nestedKeys`) to force a fully flat output.
 */
export function writeJson(
  filePath: string,
  data: Record<string, string>,
  nestedKeys?: Set<string>
): void {
  const out =
    nestedKeys && nestedKeys.size > 0 ? unflattenJson(data, nestedKeys) : data;
  const content = JSON.stringify(out, null, 2) + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Merges `newTranslations` into `existingData`, sorts keys to match the
 * English key order, and writes the result preserving the EN file's
 * per-leaf nested/flat shape so a language file always mirrors the
 * source structure. `enFilePath` is used as the shape source of truth.
 */
function mergeAndWriteJson(
  filePath: string,
  existingData: Record<string, string>,
  newTranslations: Record<string, string>,
  enKeys: string[],
  enFilePath: string
): void {
  const combined = { ...existingData, ...newTranslations };
  const sorted: Record<string, string> = {};

  // First pass: keys in English order
  for (const key of enKeys) {
    if (Object.prototype.hasOwnProperty.call(combined, key)) {
      sorted[key] = combined[key];
    }
  }
  // Second pass: any extra keys not in English (shouldn't happen normally)
  for (const key of Object.keys(combined)) {
    if (!Object.prototype.hasOwnProperty.call(sorted, key)) {
      sorted[key] = combined[key];
    }
  }

  // Mirror EN's shape unconditionally. If the user has a hard reason to
  // keep a language file in a different shape than EN, they can
  // post-process; the principle of least surprise is "all locale files
  // look structurally the same as the source".
  const shape = getJsonShape(enFilePath);
  writeJson(filePath, sorted, shape);
}

// ---------------------------------------------------------------------------
// Java Properties helpers
// ---------------------------------------------------------------------------

/** Reads a Java `.properties` file. Returns `null` if missing. */
export function readProperties(filePath: string): Record<string, string> | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return parseProperties(fileContent);
  } catch {
    return null;
  }
}

/** Parses a `.properties` file body into key/value pairs. */
function parseProperties(content: string): Record<string, string> {
  const lines = content.split(/\r?\n/);
  const data: Record<string, string> = {};

  let currentKey: string | null = null;
  let currentValue = '';
  let isMultiLine = false;

  for (const rawLine of lines) {
    const line = rawLine;

    // Skip blanks and comments when not in a continuation
    if (!isMultiLine) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) {
        continue;
      }
    }

    if (isMultiLine) {
      const joined = line.replace(/^\s+/, ' ');
      if (joined.trimEnd().endsWith('\\')) {
        currentValue += joined.trimEnd().slice(0, -1);
      } else {
        currentValue += joined;
        if (currentKey !== null) {
          data[currentKey] = currentValue;
        }
        currentKey = null;
        currentValue = '';
        isMultiLine = false;
      }
      continue;
    }

    const separatorIndex = line.search(/[=:]/);
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.substring(0, separatorIndex).trim();
    const value = line.substring(separatorIndex + 1).trim();

    if (value.trimEnd().endsWith('\\')) {
      currentKey = key;
      currentValue = value.trimEnd().slice(0, -1);
      isMultiLine = true;
    } else {
      data[key] = value;
    }
  }

  // Handle unterminated continuation
  if (isMultiLine && currentKey !== null) {
    data[currentKey] = currentValue;
  }

  return data;
}

/**
 * Merges new translations into an existing `.properties` file while
 * preserving its original structure (comments, ordering, multi-line values).
 */
function mergeAndWriteProperties(
  filePath: string,
  _existingData: Record<string, string>,
  newTranslations: Record<string, string>,
  enKeys: string[]
): void {
  if (!fs.existsSync(filePath)) {
    writePropertiesSimple(filePath, newTranslations, enKeys);
    return;
  }

  const originalContent = fs.readFileSync(filePath, 'utf8');
  const lines = originalContent.split(/\r?\n/);
  const existingKeys = new Set(Object.keys(_existingData));

  // Find the last non-comment, non-blank line to insert after
  let insertionPoint = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!') && trimmed.includes('=')) {
      insertionPoint = i + 1;
      break;
    }
  }

  const newLines: string[] = [];
  for (const key of enKeys) {
    if (newTranslations[key] && !existingKeys.has(key)) {
      const value = newTranslations[key];
      newLines.push(...formatPropertyLine(key, value));
    }
  }

  if (newLines.length === 0) {
    return;
  }

  const finalLines = [
    ...lines.slice(0, insertionPoint),
    ...newLines,
    ...lines.slice(insertionPoint),
  ];

  fs.writeFileSync(filePath, finalLines.join('\n'), 'utf8');
}

/** Formats a single property entry, wrapping long values across multiple lines. */
function formatPropertyLine(key: string, value: string): string[] {
  const MAX_LINE_LENGTH = 100;

  if (value.length <= MAX_LINE_LENGTH) {
    return [`${key}=${value}`];
  }

  const words = value.split(' ');
  const wrappedLines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 > MAX_LINE_LENGTH && currentLine.length > 0) {
      wrappedLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine += (currentLine.length > 0 ? ' ' : '') + word;
    }
  }
  if (currentLine.length > 0) {
    wrappedLines.push(currentLine);
  }

  if (wrappedLines.length <= 1) {
    return [`${key}=${value}`];
  }

  const result: string[] = [];
  result.push(`${key}=${wrappedLines[0]} \\`);
  for (let i = 1; i < wrappedLines.length; i++) {
    result.push(i < wrappedLines.length - 1 ? `${wrappedLines[i]} \\` : wrappedLines[i]);
  }
  return result;
}

/** Writes properties as a simple flat file (used when creating a new file). */
function writePropertiesSimple(
  filePath: string,
  data: Record<string, string>,
  sortedKeys: string[]
): void {
  let content = '';
  for (const key of sortedKeys) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      content += `${key}=${data[key] || ''}\n`;
    }
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

/**
 * Inspects a directory and returns a `ProjectConfig` describing the i18n
 * layout, or `null` if no recognized i18n files are found.
 */
export function detectProjectConfig(i18nDir: string): ProjectConfig | null {
  const jsonPath = path.join(i18nDir, 'i18n-en.json');
  const propsPath = path.join(i18nDir, 'Messages.properties');

  if (fs.existsSync(jsonPath)) {
    return {
      mode: 'json',
      enFilePath: jsonPath,
      baseEnFileName: 'i18n-en.json',
      langFileRegex: I18N_JSON_FILE_REGEX,
      getLang: (fileName) => {
        const match = I18N_JSON_FILE_REGEX.exec(fileName);
        return match ? match[1] : '';
      },
      getLangFilePath: (lang) => path.join(i18nDir, `i18n-${lang}.json`),
      readFile: readJson,
      // Wrap mergeAndWriteJson to close over the EN file path so it can
      // recover the per-leaf nested/flat shape at write time without
      // changing the public `mergeTranslations` interface.
      mergeTranslations: (filePath, existingData, newTranslations, enKeys) =>
        mergeAndWriteJson(filePath, existingData, newTranslations, enKeys, jsonPath),
    };
  }

  if (fs.existsSync(propsPath)) {
    return {
      mode: 'properties',
      enFilePath: propsPath,
      baseEnFileName: 'Messages.properties',
      langFileRegex: MESSAGES_PROPERTIES_FILE_REGEX,
      getLang: (fileName) => {
        const match = MESSAGES_PROPERTIES_FILE_REGEX.exec(fileName);
        return match ? match[1] : '';
      },
      getLangFilePath: (lang) => path.join(i18nDir, `Messages_${lang}.properties`),
      readFile: readProperties,
      mergeTranslations: mergeAndWriteProperties,
    };
  }

  return null;
}
