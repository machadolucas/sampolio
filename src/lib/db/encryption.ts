import * as fs from 'fs/promises';
import * as path from 'path';
import { isSafeId, isChunkMonth } from '@/lib/safe-id';

// The app's master key, the data directory and the id/path guards. All data
// lives in the SQLCipher DB, whose key `sqlite/key.ts` derives from
// `getEncryptionKey()`; avatars are the only per-user files.

// Get the encryption key from the environment. In production a missing key is
// a hard failure: falling back to the publicly known default would silently
// encrypt real data with a compromised key. Called lazily at request time, so
// `next build` never needs the key.
export function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY must be set in production — refusing to fall back to the default key.');
    }
    // Development-only convenience fallback.
    console.warn('ENCRYPTION_KEY not set, using default dev key. Set ENCRYPTION_KEY in production!');
    return 'sampolio-default-encryption-key-change-in-prod';
  }
  return key;
}

// Get the data directory path
export function getDataDir(): string {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  return dataDir;
}

// ============================================================
// Path guards
// ============================================================
// Ids reach the DB layer straight from server-action arguments and import
// payloads. Every DB module passes each id through `assertSafeId` (split
// months through `assertChunkMonth`) before it becomes a row key, and the one
// remaining per-user path (`getUserDir`, avatars) is checked the same way;
// `ensureDir` re-checks that the resolved path stays inside DATA_DIR.

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

/** Throws unless `id` is a plain id segment (`[A-Za-z0-9_-]{1,64}`). */
export function assertSafeId(id: unknown, label = 'id'): string {
  if (!isSafeId(id)) throw new UnsafePathError(`Invalid ${label}`);
  return id;
}

/** Throws unless `yearMonth` has the `YYYY-MM` shape (split chunk names). */
export function assertChunkMonth(yearMonth: unknown, label = 'month'): string {
  if (!isChunkMonth(yearMonth)) throw new UnsafePathError(`Invalid ${label}`);
  return yearMonth;
}

/**
 * Defence in depth: the resolved path must be inside DATA_DIR (strictly, unless
 * `allowRoot` lets DATA_DIR itself through).
 */
export function assertInsideDataDir(targetPath: string, opts?: { allowRoot?: boolean }): string {
  const root = path.resolve(getDataDir());
  const resolved = path.resolve(targetPath);
  if (!(resolved.startsWith(root + path.sep) || (opts?.allowRoot && resolved === root))) {
    throw new UnsafePathError('Path escapes the data directory');
  }
  return resolved;
}

// Get user-specific directory
export function getUserDir(userId: string): string {
  return path.join(getDataDir(), 'users', assertSafeId(userId, 'user id'));
}

// Ensure directory exists
export async function ensureDir(dirPath: string): Promise<void> {
  assertInsideDataDir(dirPath, { allowRoot: true });
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}
