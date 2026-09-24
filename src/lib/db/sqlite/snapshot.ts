import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { getDataDir } from '../encryption';
import { getSqlite, openEncryptedDatabase } from './client';
import { getSqliteKeyHex } from './key';

/**
 * Consistent, still-encrypted copy of the live DB for backups:
 * `${DATA_DIR}/snapshots/sampolio.db`.
 *
 * The live `sampolio.db` (+ `-wal`/`-shm`) is never safe to copy with `tar`
 * while the app runs, so backups archive this snapshot instead.
 *
 * `VACUUM INTO '<plain path>'` on the keyed connection: SQLite3MultipleCiphers
 * encrypts the target with the main database's cipher and key. (The
 * `file:…?cipher=…&hexkey=…` URI form is NOT usable: better-sqlite3 opens
 * connections without SQLITE_OPEN_URI, so the URI is taken as a literal
 * filename.) Never use `db.backup()`: its destination is a new, UNKEYED
 * connection, so the copy would be plaintext. Every snapshot is verified
 * before it replaces the previous one — not a plaintext header, opens with
 * the key, fails without it — so a driver change that ever produced a
 * plaintext copy would fail loudly instead of being published.
 *
 * Mirrored for manual/deploy use by `scripts/db-snapshot.mjs`.
 */

export const SNAPSHOT_DIR_NAME = 'snapshots';
const PLAINTEXT_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

export function getSnapshotPath(): string {
  return path.join(getDataDir(), SNAPSHOT_DIR_NAME, 'sampolio.db');
}

/** Throws unless `file` is a SQLCipher DB that opens with `keyHex` and
 * refuses to open without a key. */
export function verifyEncryptedDbFile(file: string, keyHex: string): void {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    if (header.equals(PLAINTEXT_HEADER)) {
      throw new Error(`${file} is a PLAINTEXT SQLite file`);
    }
  } finally {
    fs.closeSync(fd);
  }

  const keyed = openEncryptedDatabase(file, keyHex, { readonly: true });
  try {
    const row = keyed.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
    if (row?.quick_check !== 'ok') throw new Error(`${file} failed quick_check: ${JSON.stringify(row)}`);
  } finally {
    keyed.close();
  }

  const unkeyed = new Database(file, { readonly: true, fileMustExist: true });
  let openedWithoutKey = false;
  try {
    unkeyed.prepare('SELECT count(*) FROM sqlite_master').get();
    openedWithoutKey = true;
  } catch {
    /* expected: "file is not a database" */
  } finally {
    unkeyed.close();
  }
  if (openedWithoutKey) throw new Error(`${file} opened WITHOUT the key`);
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface SnapshotResult {
  path: string;
  bytes: number;
}

/** Write + verify + atomically publish a snapshot. */
export function createSnapshot(): SnapshotResult {
  const keyHex = getSqliteKeyHex();
  const target = getSnapshotPath();
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.sampolio.db.tmp-${process.pid}-${Date.now()}`);
  fs.rmSync(tmp, { force: true });

  try {
    getSqlite().exec(`VACUUM INTO ${sqlQuote(tmp)}`);
    fs.chmodSync(tmp, 0o600);
    verifyEncryptedDbFile(tmp, keyHex);
    fs.renameSync(tmp, target);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  return { path: target, bytes: fs.statSync(target).size };
}

const SIX_HOURS = 6 * 60 * 60 * 1000;
const globalForSnapshots = globalThis as typeof globalThis & { __sampolioSnapshotTimers?: NodeJS.Timeout[] };

function runSnapshotLogged(reason: string): void {
  try {
    const { path: file, bytes } = createSnapshot();
    console.log(`[db] snapshot (${reason}) written: ${file} (${bytes} bytes, encrypted, verified)`);
  } catch (error) {
    console.error(`[db] snapshot (${reason}) FAILED:`, error);
  }
}

/** ms until the next local 04:55 — just before the nightly 05:10 backup. */
function msUntilNextDaily(hour = 4, minute = 55, now = new Date()): number {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Snapshot now, then every 6 h and daily at 04:55 (local). Idempotent per
 * process. Called from `src/instrumentation.ts` after migrations/import.
 */
export function startSnapshotScheduler(): void {
  if (globalForSnapshots.__sampolioSnapshotTimers) return;
  runSnapshotLogged('startup');
  const timers: NodeJS.Timeout[] = [];
  const interval = setInterval(() => runSnapshotLogged('6h'), SIX_HOURS);
  interval.unref();
  timers.push(interval);
  const scheduleDaily = () => {
    const t = setTimeout(() => {
      runSnapshotLogged('daily');
      scheduleDaily();
    }, msUntilNextDaily());
    t.unref();
    timers[1] = t;
  };
  scheduleDaily();
  globalForSnapshots.__sampolioSnapshotTimers = timers;
}
