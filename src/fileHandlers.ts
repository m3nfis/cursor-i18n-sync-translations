import * as fs from 'fs';
import * as path from 'path';
import { I18N_JSON_FILE_REGEX, MESSAGES_PROPERTIES_FILE_REGEX } from './localeUtils';

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

/** Reads a JSON i18n file. Returns `null` if the file is missing or invalid. */
export function readJson(filePath: string): Record<string, string> | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Writes a flat key/value object as pretty-printed JSON. */
export function writeJson(filePath: string, data: Record<string, string>): void {
  const content = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Merges `newTranslations` into `existingData`, sorts keys to match
 * the English key order, and writes the result.
 */
function mergeAndWriteJson(
  filePath: string,
  existingData: Record<string, string>,
  newTranslations: Record<string, string>,
  enKeys: string[]
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

  writeJson(filePath, sorted);
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
      mergeTranslations: mergeAndWriteJson,
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
