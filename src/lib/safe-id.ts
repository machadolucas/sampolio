// Formats of every identifier that becomes part of a filesystem path under
// DATA_DIR. Shared by the DB path guard (`src/lib/db/encryption.ts`) and the
// action-boundary Zod schemas (`src/lib/schemas/id.schema.ts`), so both layers
// accept exactly the same values. Dependency-free on purpose.
//
// Every persisted id is a `uuid` v4 (entities, Better Auth users via
// `generateId: 'uuid'`, bank connections/links); tests use short slugs such as
// `goal-1`. No legitimate id contains `.`, `/` or `\`, so `..` traversal is
// impossible for a value that matches.
export const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// A real calendar month `YYYY-MM` (projection/import month fields).
export const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// Split-group expense chunk names (`expenses/{YYYY-MM}.enc`). Deliberately
// only shape-checked: chunk months are `date.slice(0, 7)` of dates validated as
// `\d{4}-\d{2}-\d{2}`, so a stored chunk must never become unreadable here.
export const CHUNK_MONTH_PATTERN = /^\d{4}-\d{2}$/;

export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value);
}

export function isYearMonth(value: unknown): value is string {
  return typeof value === 'string' && YEAR_MONTH_PATTERN.test(value);
}

export function isChunkMonth(value: unknown): value is string {
  return typeof value === 'string' && CHUNK_MONTH_PATTERN.test(value);
}
