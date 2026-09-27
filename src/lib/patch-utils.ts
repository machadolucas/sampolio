/**
 * Helpers for partial-update ("patch") server actions.
 *
 * Update schemas accept `null` for optional fields as the explicit "clear this
 * field" signal. The DB layer merges with `{ ...stored, ...patch }`, so a key
 * that is present with an `undefined` value clears the stored field (JSON
 * serialization drops it), while an absent key keeps the stored value.
 */

type NullCleared<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? Exclude<T[P], null> : T[P];
};

/**
 * Map `null → undefined` for the given nullable keys, but only for keys that
 * are actually present in the parsed patch. Absent keys stay absent, so a
 * toggle-only patch such as `{ isActive: false }` never clears unrelated
 * optional fields like `endDate` or `category`.
 */
export function clearNullsInPatch<T extends object, K extends keyof T>(
  patch: T,
  keys: readonly K[]
): NullCleared<T, K> {
  const result = { ...patch } as Record<PropertyKey, unknown>;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      result[key as PropertyKey] = patch[key] ?? undefined;
    }
  }
  return result as NullCleared<T, K>;
}
