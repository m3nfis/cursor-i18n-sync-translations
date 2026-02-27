import * as fs from 'fs';
import * as path from 'path';

/** Persistent state for a resumable translation sync session. */
export interface SyncState {
  status: string;
  missingKeysByLang: Record<string, Record<string, string>>;
  translatedResults: Record<string, Record<string, string>>;
  completedBatchIds: number[];
  completedLanguages: string[];
}

/**
 * Manages a temporary JSON file that stores in-progress sync state.
 * This allows a sync to be interrupted and resumed without losing work.
 */
export class StateManager {
  private readonly tmpFilePath: string;

  constructor(i18nDir: string) {
    this.tmpFilePath = path.join(i18nDir, '.translations.tmp.json');
  }

  /** Returns `true` if a previous incomplete sync exists on disk. */
  hasResumableState(): boolean {
    return fs.existsSync(this.tmpFilePath);
  }

  /** Loads saved sync state from disk. Returns `null` if missing or corrupt. */
  load(): SyncState | null {
    try {
      if (!fs.existsSync(this.tmpFilePath)) {
        return null;
      }
      const raw = fs.readFileSync(this.tmpFilePath, 'utf8');
      const parsed = JSON.parse(raw) as SyncState;

      // Basic shape validation
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !parsed.missingKeysByLang ||
        !parsed.translatedResults ||
        !Array.isArray(parsed.completedBatchIds)
      ) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  /** Persists the current sync state to disk. */
  save(state: SyncState): void {
    try {
      const content = JSON.stringify(state, null, 2) + '\n';
      fs.writeFileSync(this.tmpFilePath, content, 'utf8');
    } catch {
      // Silently ignore write failures for the temp file
    }
  }

  /** Removes the temporary state file from disk. */
  cleanup(): void {
    try {
      if (fs.existsSync(this.tmpFilePath)) {
        fs.unlinkSync(this.tmpFilePath);
      }
    } catch {
      // Silently ignore cleanup failures
    }
  }

  /** Absolute path to the temp state file. */
  get filePath(): string {
    return this.tmpFilePath;
  }
}
