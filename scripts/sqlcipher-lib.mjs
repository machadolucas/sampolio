// Shared SQLCipher helpers for the maintenance scripts (db-snapshot.mjs,
// rotate-encryption-key.mjs). Mirrors src/lib/db/sqlite/{key,client,snapshot}.ts
// byte for byte — keep them in sync.
//
// `better-sqlite3` resolves to the pnpm alias for
// better-sqlite3-multiple-ciphers (the SQLCipher build), so run these from the
// repo root after `pnpm install`.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';

export const SQLITE_KEY_INFO = 'sampolio-sqlite-v1'; // must match src/lib/db/sqlite/key.ts
export const DB_FILE_NAME = 'sampolio.db';
const PLAINTEXT_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

export function deriveSqliteKeyHex(encryptionKey) {
  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(encryptionKey, 'utf8'), Buffer.alloc(0), Buffer.from(SQLITE_KEY_INFO), 32),
  ).toString('hex');
}

/** Open with the raw hex key; throws on a wrong key / plaintext file. */
export function openEncrypted(file, keyHex, { readonly = false } = {}) {
  const db = new Database(file, { readonly, fileMustExist: true });
  try {
    db.pragma(`cipher='sqlcipher'`);
    db.pragma('legacy=4');
    db.pragma(`hexkey='${keyHex}'`);
    db.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch (e) {
    db.close();
    throw new Error(`cannot open ${path.basename(file)} with this key (${e.message})`);
  }
  return db;
}

/** Throws unless `file` is SQLCipher, opens with the key, and not without. */
export function verifyEncryptedDbFile(file, keyHex) {
  const header = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (header.equals(PLAINTEXT_HEADER)) throw new Error(`${file} is a PLAINTEXT SQLite file`);

  const keyed = openEncrypted(file, keyHex, { readonly: true });
  try {
    const row = keyed.prepare('PRAGMA quick_check').get();
    if (row?.quick_check !== 'ok') throw new Error(`${file} failed quick_check`);
  } finally {
    keyed.close();
  }

  const unkeyed = new Database(file, { readonly: true, fileMustExist: true });
  let opened = false;
  try {
    unkeyed.prepare('SELECT count(*) FROM sqlite_master').get();
    opened = true;
  } catch {
    /* expected */
  } finally {
    unkeyed.close();
  }
  if (opened) throw new Error(`${file} opened WITHOUT the key`);
}

/**
 * VACUUM INTO a temp file (SQLite3MultipleCiphers encrypts it with the source
 * connection's key — the file:…?hexkey= URI form does not work because
 * better-sqlite3 does not enable URI filenames), verify, then atomically
 * replace <dataDir>/snapshots/sampolio.db.
 */
export function writeSnapshot(db, dataDir, keyHex) {
  const dir = path.join(dataDir, 'snapshots');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, DB_FILE_NAME);
  const tmp = path.join(dir, `.sampolio.db.tmp-${process.pid}-${Date.now()}`);
  fs.rmSync(tmp, { force: true });
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    fs.chmodSync(tmp, 0o600);
    verifyEncryptedDbFile(tmp, keyHex);
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return { path: target, bytes: fs.statSync(target).size };
}

/** ENCRYPTION_KEY from env, else <DATA_DIR>/.encryption_key. */
export function resolveEncryptionKey(dataDir) {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;
  const file = path.join(dataDir, '.encryption_key');
  try {
    const key = fs.readFileSync(file, 'utf8').trim();
    if (key) {
      console.warn(`ENCRYPTION_KEY not set; using ${file}`);
      return key;
    }
  } catch {
    /* fall through */
  }
  return null;
}
