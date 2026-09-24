import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getDataDir } from '../encryption';
import { getSqliteKeyHex } from './key';
import { runMigrations } from './migrate';
import { getSetupFailure } from './setup-state';
import * as schema from './schema';

/**
 * SQLCipher-encrypted SQLite database at `${DATA_DIR}/sampolio.db`.
 *
 * `better-sqlite3` is a pnpm alias for `better-sqlite3-multiple-ciphers`, so
 * the plain driver import (and drizzle's `drizzle-orm/better-sqlite3`) get the
 * cipher build. The connection is opened lazily on first use — never at
 * import time, because `next build` evaluates server modules — and kept on
 * `globalThis` so dev HMR and multiple module instances share one handle.
 */

export type SampolioDb = BetterSQLite3Database<typeof schema>;

export const DB_FILE_NAME = 'sampolio.db';

interface DbHandle {
  file: string;
  sqlite: Database.Database;
  db: SampolioDb;
  /** true when this process created the file (it did not exist before open). */
  createdNow: boolean;
}

const globalForDb = globalThis as typeof globalThis & { __sampolioDb?: DbHandle };

export function getDbPath(): string {
  return path.join(getDataDir(), DB_FILE_NAME);
}

/**
 * Open a SQLCipher database with the raw hex key. The cipher PRAGMAs must be
 * the very first statements on the connection. `PRAGMA hexkey` itself never
 * fails on a wrong key, so the key is verified by reading `sqlite_master`
 * (throws "file is not a database" on a wrong key or a plaintext file).
 */
export function openEncryptedDatabase(file: string, keyHex: string, options: { readonly?: boolean } = {}): Database.Database {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error('SQLCipher key must be 64 hex characters');
  }
  const sqlite = new Database(file, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false });
  try {
    sqlite.pragma(`cipher='sqlcipher'`);
    sqlite.pragma('legacy=4');
    sqlite.pragma(`hexkey='${keyHex}'`);
    sqlite.prepare('SELECT count(*) AS n FROM sqlite_master').get();
  } catch (error) {
    sqlite.close();
    throw new Error(
      `Cannot open ${path.basename(file)}: wrong ENCRYPTION_KEY or not a SQLCipher database (${(error as Error).message})`,
    );
  }
  return sqlite;
}

function openHandle(file: string): DbHandle {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const createdNow = !fs.existsSync(file);
  const sqlite = openEncryptedDatabase(file, getSqliteKeyHex());
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    // Keep the DB and its WAL/SHM sidecars owner-only, like the key files.
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best-effort */
    }
    const db = drizzle(sqlite, { schema });
    runMigrations(db);
    return { file, sqlite, db, createdNow };
  } catch (error) {
    // Never leak a half-initialized handle (each request would open another).
    sqlite.close();
    throw error;
  }
}

function getHandle(): DbHandle {
  const failure = getSetupFailure();
  if (failure?.dbDiscarded) {
    throw new Error(`Database unavailable: startup setup failed (${failure.message}). Fix the cause and restart.`);
  }
  const file = getDbPath();
  const current = globalForDb.__sampolioDb;
  if (current && current.file === file && current.sqlite.open) return current;
  if (current?.sqlite.open) current.sqlite.close();
  const handle = openHandle(file);
  globalForDb.__sampolioDb = handle;
  return handle;
}

/** Drizzle handle for the encrypted DB (opens + migrates on first call). */
export function getDb(): SampolioDb {
  return getHandle().db;
}

/** Raw better-sqlite3 connection (transactions, VACUUM INTO, PRAGMAs). */
export function getSqlite(): Database.Database {
  return getHandle().sqlite;
}

/** Whether the open DB file was created by this process (see bootstrap.ts). */
export function wasDbCreatedByThisProcess(): boolean {
  return !!globalForDb.__sampolioDb?.createdNow;
}

/**
 * Close the connection and delete sampolio.db (+ -wal/-shm) — ONLY when this
 * process created the file and nothing else can hold data in it (bootstrap,
 * before the server takes requests). Returns false (and deletes nothing)
 * otherwise.
 */
export function discardNewlyCreatedDb(): boolean {
  const current = globalForDb.__sampolioDb;
  if (!current?.createdNow) return false;
  if (current.sqlite.open) current.sqlite.close();
  globalForDb.__sampolioDb = undefined;
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    fs.rmSync(`${current.file}${suffix}`, { force: true });
  }
  return true;
}

/** Close the shared connection (tests; graceful shutdown). */
export function closeDb(): void {
  const current = globalForDb.__sampolioDb;
  if (current?.sqlite.open) current.sqlite.close();
  globalForDb.__sampolioDb = undefined;
}
