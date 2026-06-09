/**
 * Bidirectional flatten / unflatten for i18n JSON files.
 *
 * Real-world i18n files mix two styles, often in the same file:
 *
 *   1. **Flat dotted keys** — literal top-level string keys with dots:
 *        { "activity.DocumentAdded.label": "Signature document added" }
 *
 *   2. **Nested object keys** — JSON objects whose leaves are strings:
 *        { "agreements": { "actions": { "title": "Actions" } } }
 *
 * The translation engine, context inference, batching, and state
 * management all assume a flat `Record<string, string>` shape. So this
 * module lives at the I/O boundary: read-time `flattenJson` converts
 * either style (or a mix) to a single flat map, and write-time
 * `unflattenJson` reconstitutes the original per-key shape so saved
 * files preserve the user's chosen structure.
 *
 * Shape tracking is per-leaf (a `Set<string>` of leaves that came from
 * nested objects), not per-top-level-key, so a file that mixes both
 * styles round-trips losslessly.
 */

export interface FlattenedJson {
  /** Every leaf string value, keyed by its dotted path. */
  flat: Record<string, string>;
  /**
   * The subset of `flat` keys whose value came from inside a nested
   * object (as opposed to a literal flat dotted key). Used at write
   * time to decide whether each leaf is emitted under a nested object
   * or as a flat top-level dotted key.
   */
  nestedKeys: Set<string>;
  /** Soft warnings about unsupported values (arrays, numbers, etc.). */
  warnings: string[];
}

/**
 * Walks a parsed JSON value and returns a flat dotted-key map plus the
 * set of leaves that originated from nested objects.
 *
 * Non-string, non-object leaves (arrays, numbers, booleans, null) are
 * skipped with a warning — i18n libraries don't translate those, and
 * silently ignoring them avoids accidentally translating data the user
 * cares about. Strings nested under arrays are also skipped (arrays are
 * unusual in i18n; the common pluralization patterns use objects keyed
 * by `one`/`other`/etc., not arrays).
 */
export function flattenJson(value: unknown): FlattenedJson {
  const result: FlattenedJson = {
    flat: {},
    nestedKeys: new Set<string>(),
    warnings: [],
  };

  if (!isPlainObject(value)) {
    if (value !== undefined && value !== null) {
      result.warnings.push(
        `Top-level JSON value is not an object (got ${describeType(value)}); skipping.`
      );
    }
    return result;
  }

  for (const [topKey, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      if (result.flat[topKey] !== undefined) {
        result.warnings.push(`Duplicate top-level key "${topKey}" — overwriting previous value.`);
      }
      result.flat[topKey] = v;
      // Explicitly flat: NOT added to nestedKeys.
    } else if (isPlainObject(v)) {
      walkNested(topKey, v, result);
    } else if (Array.isArray(v)) {
      result.warnings.push(`Skipping array value at "${topKey}" (i18n arrays are not supported).`);
    } else {
      result.warnings.push(
        `Skipping non-string value at "${topKey}" (got ${describeType(v)}).`
      );
    }
  }

  return result;
}

function walkNested(prefix: string, obj: Record<string, unknown>, out: FlattenedJson): void {
  for (const [k, v] of Object.entries(obj)) {
    const full = `${prefix}.${k}`;
    if (typeof v === 'string') {
      if (out.flat[full] !== undefined) {
        out.warnings.push(
          `Key collision at "${full}" between a literal flat dotted key and a nested path — keeping the nested value.`
        );
      }
      out.flat[full] = v;
      out.nestedKeys.add(full);
    } else if (isPlainObject(v)) {
      walkNested(full, v, out);
    } else if (Array.isArray(v)) {
      out.warnings.push(`Skipping array value at "${full}" (i18n arrays are not supported).`);
    } else {
      out.warnings.push(`Skipping non-string value at "${full}" (got ${describeType(v)}).`);
    }
  }
}

/**
 * Inverse of {@link flattenJson}. Reconstitutes a nested object
 * structure from a flat dotted-key map using `nestedKeys` to decide
 * which leaves get nested under intermediate objects and which stay as
 * literal top-level dotted keys.
 *
 * Order of `flat` is preserved in the output (relies on V8's stable
 * insertion-order iteration), so callers can sort `flat` by their
 * desired order (typically EN key order) before passing it in.
 */
export function unflattenJson(
  flat: Record<string, string>,
  nestedKeys: Set<string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flat)) {
    if (!nestedKeys.has(key)) {
      result[key] = value;
      continue;
    }

    const parts = key.split('.');
    let cursor: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const existing = cursor[seg];
      if (!isPlainObject(existing)) {
        // Either undefined, or a colliding literal value — in the
        // collision case we overwrite, but flattenJson would have
        // already emitted a warning. Defensive: don't crash here.
        cursor[seg] = {};
      }
      cursor = cursor[seg] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
  }

  return result;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describeType(v: unknown): string {
  if (v === null) {
    return 'null';
  }
  if (Array.isArray(v)) {
    return 'array';
  }
  return typeof v;
}
