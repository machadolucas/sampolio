import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTempDataDir } from '@/test/temp-data-dir';
import { closeDb, getDb, getDbPath, getSqlite, openEncryptedDatabase } from './client';
import { deriveSqliteKeyHex, getSqliteKeyHex } from './key';
import { runMigrations } from './migrate';
import { createSnapshot, getSnapshotPath, verifyEncryptedDbFile } from './snapshot';
import { user } from './schema';

const PLAINTEXT_HEADER = 'SQLite format 3\0';

function header(file: string): string {
  return fs.readFileSync(file).subarray(0, 16).toString('latin1');
}

let tmp: ReturnType<typeof useTempDataDir>;

beforeAll(() => {
  tmp = useTempDataDir();
  closeDb();
});

afterAll(() => {
  closeDb();
  tmp.cleanup();
});

describe('SQLCipher key + encryption', () => {
  it('derives a stable 64-hex key that differs per ENCRYPTION_KEY', () => {
    const k = getSqliteKeyHex();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(getSqliteKeyHex()).toBe(k);
    expect(deriveSqliteKeyHex('something-else')).not.toBe(k);
  });

  it('writes an encrypted file (no plaintext SQLite header)', () => {
    getDb();
    getSqlite().pragma('wal_checkpoint(TRUNCATE)');
    const file = getDbPath();
    expect(fs.existsSync(file)).toBe(true);
    expect(header(file)).not.toBe(PLAINTEXT_HEADER);
  });

  it('refuses to open with a wrong key or without a key', () => {
    const file = getDbPath();
    expect(() => openEncryptedDatabase(file, deriveSqliteKeyHex('wrong-key'))).toThrow(/wrong ENCRYPTION_KEY|not a SQLCipher/);
    const plain = new Database(file, { readonly: true });
    expect(() => plain.prepare('SELECT count(*) FROM sqlite_master').get()).toThrow(/not a database/);
    plain.close();
  });

  it('opens with the right key and has the auth tables', () => {
    const tables = getSqlite()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(['user', 'session', 'account', 'verification', 'passkey', 'rateLimit', '_meta']));
    expect(getSqlite().pragma('foreign_keys', { simple: true })).toBe(1);
    expect(getSqlite().pragma('journal_mode', { simple: true })).toBe('wal');
  });
});

describe('migrations', () => {
  it('are idempotent', () => {
    const count = () =>
      (getSqlite().prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
    const before = count();
    expect(before).toBeGreaterThan(0);
    runMigrations(getDb());
    runMigrations(getDb());
    expect(count()).toBe(before);

    // A reopened connection re-runs the migrator as a no-op too.
    closeDb();
    getDb();
    expect(count()).toBe(before);
  });
});

describe('user rows', () => {
  // Synthetic users (repo rule: Alex, Sam, *@example.com) for the snapshot below.
  it('stores users', () => {
    const now = new Date();
    for (const [id, name] of [
      ['2f0c1d8e-4b7a-4c1e-9a3f-0d6b5e8c7a11', 'Alex'],
      ['7a9e3b21-5c4d-4f6e-8b2a-1c3d5e7f9a22', 'Sam'],
    ]) {
      getDb()
        .insert(user)
        .values({ id, name, email: `${name.toLowerCase()}@example.com`, emailVerified: false, createdAt: now, updatedAt: now })
        .run();
    }
    expect(getDb().select().from(user).all()).toHaveLength(2);
  });
});

describe('snapshot', () => {
  it('writes a verified, encrypted copy via VACUUM INTO', () => {
    const { path: file, bytes } = createSnapshot();
    expect(file).toBe(getSnapshotPath());
    expect(bytes).toBeGreaterThan(0);
    expect(header(file)).not.toBe(PLAINTEXT_HEADER);
    expect(() => verifyEncryptedDbFile(file, getSqliteKeyHex())).not.toThrow();

    const keyed = openEncryptedDatabase(file, getSqliteKeyHex(), { readonly: true });
    const n = (keyed.prepare('SELECT count(*) AS n FROM user').get() as { n: number }).n;
    keyed.close();
    expect(n).toBe(2);

    const unkeyed = new Database(file, { readonly: true });
    expect(() => unkeyed.prepare('SELECT count(*) FROM sqlite_master').get()).toThrow(/not a database/);
    unkeyed.close();

    expect(() => openEncryptedDatabase(file, deriveSqliteKeyHex('wrong-key'), { readonly: true })).toThrow();
    // No temp files left behind.
    expect(fs.readdirSync(path.dirname(file))).toEqual(['sampolio.db']);
  });

  it('rejects a plaintext file', () => {
    const plainFile = path.join(tmp.dir, 'plain.db');
    const plain = new Database(plainFile);
    plain.exec('CREATE TABLE t (x)');
    plain.close();
    expect(() => verifyEncryptedDbFile(plainFile, getSqliteKeyHex())).toThrow(/PLAINTEXT/);
  });
});
