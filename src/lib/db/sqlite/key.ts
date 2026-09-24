import * as crypto from 'crypto';
import { getEncryptionKey } from '../encryption';

/**
 * SQLCipher key for `sampolio.db`, derived from `ENCRYPTION_KEY` so the app
 * keeps exactly one secret. HKDF-SHA256 with a purpose label keeps the DB key
 * independent from the per-file `.enc` keys (`sampolio-file-encryption-v1`).
 *
 * Never change the info label or salt: an existing database stops opening.
 * `scripts/db-snapshot.mjs` and `scripts/rotate-encryption-key.mjs` mirror this
 * derivation byte for byte.
 */
export const SQLITE_KEY_INFO = 'sampolio-sqlite-v1';

export function deriveSqliteKeyHex(encryptionKey: string): string {
  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(encryptionKey, 'utf8'), Buffer.alloc(0), Buffer.from(SQLITE_KEY_INFO), 32),
  ).toString('hex');
}

/** Raw 64-char hex key for `PRAGMA hexkey`. Uses the same production guard as
 * the file encryption (missing key throws in production). */
export function getSqliteKeyHex(): string {
  return deriveSqliteKeyHex(getEncryptionKey());
}
