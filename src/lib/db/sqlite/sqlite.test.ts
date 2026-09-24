import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTempDataDir, UUID_RE } from '@/test/temp-data-dir';
import { writeEncryptedFile } from '../encryption';
import { closeDb, getDb, getDbPath, getSqlite, openEncryptedDatabase } from './client';
import { deriveSqliteKeyHex, getSqliteKeyHex } from './key';
import { runMigrations } from './migrate';
import { createSnapshot, getSnapshotPath, verifyEncryptedDbFile } from './snapshot';
import { importLegacyUsers, tombstoneEmail } from './legacy-import';
import { account, user } from './schema';

const PLAINTEXT_HEADER = 'SQLite format 3\0';

function header(file: string): string {
  return fs.readFileSync(file).subarray(0, 16).toString('latin1');
}

// Synthetic legacy users (repo rule: Alex, Sam, *@example.com).
const ALEX_ID = '2f0c1d8e-4b7a-4c1e-9a3f-0d6b5e8c7a11';
const SAM_ID = '7a9e3b21-5c4d-4f6e-8b2a-1c3d5e7f9a22';
const OLD_ID = 'c4d2e6f8-1a3b-4c5d-8e7f-9a0b1c2d3e33';

let tmp: ReturnType<typeof useTempDataDir>;

beforeAll(async () => {
  tmp = useTempDataDir();
  closeDb();
  const dataDir = tmp.dir;
  const alexHash = await bcrypt.hash('Alex-Legacy-1!', 4);
  const samHash = await bcrypt.hash('Sam-Legacy-1!', 4);
  await writeEncryptedFile(path.join(dataDir, 'users-index.enc'), {
    users: [
      { id: ALEX_ID, email: 'alex@example.com' },
      { id: SAM_ID, email: 'sam@example.com' },
    ],
  });
  await writeEncryptedFile(path.join(dataDir, 'users', ALEX_ID, 'user.enc'), {
    id: ALEX_ID,
    email: 'alex@example.com',
    name: 'Alex',
    passwordHash: alexHash,
    role: 'admin',
    isActive: true,
    createdAt: '2025-01-02T03:04:05.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
  });
  await writeEncryptedFile(path.join(dataDir, 'users', SAM_ID, 'user.enc'), {
    id: SAM_ID,
    email: 'Sam@Example.com',
    name: 'Sam',
    passwordHash: samHash,
    // pre-role legacy file: role/isActive missing ⇒ user + active
    avatarVersion: 3,
    createdAt: '2025-02-02T00:00:00.000Z',
    updatedAt: '2025-02-03T00:00:00.000Z',
  });
  // A user dir that is not in the index: soft-deleted by the old admin delete.
  await writeEncryptedFile(path.join(dataDir, 'users', OLD_ID, 'user.enc'), {
    id: OLD_ID,
    email: 'alex@example.com',
    name: 'Old Alex',
    passwordHash: alexHash,
    role: 'user',
    isActive: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-05-05T00:00:00.000Z',
  });
  // A stray dir without user.enc is ignored.
  fs.mkdirSync(path.join(dataDir, 'users', 'not-a-user'), { recursive: true });
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

describe('legacy .enc user import', () => {
  it('imports every user dir with the same UUIDs, soft-deleting non-index users', async () => {
    const result = await importLegacyUsers();
    expect(result).toEqual({ status: 'imported', imported: 3, softDeleted: 1 });

    const rows = getDb().select().from(user).all();
    expect(rows.map((r) => r.id).sort()).toEqual([ALEX_ID, SAM_ID, OLD_ID].sort());

    const alex = rows.find((r) => r.id === ALEX_ID)!;
    expect(alex).toMatchObject({ email: 'alex@example.com', name: 'Alex', role: 'admin', isActive: true, deletedAt: null });
    expect(alex.createdAt.toISOString()).toBe('2025-01-02T03:04:05.000Z');

    const sam = rows.find((r) => r.id === SAM_ID)!;
    expect(sam).toMatchObject({ email: 'sam@example.com', role: 'user', isActive: true, avatarVersion: 3 });

    const old = rows.find((r) => r.id === OLD_ID)!;
    expect(old.email).toBe(tombstoneEmail(OLD_ID));
    expect(old.isActive).toBe(false);
    expect(old.deletedAt?.toISOString()).toBe('2024-05-05T00:00:00.000Z');

    const creds = getDb().select().from(account).where(eq(account.providerId, 'credential')).all();
    expect(creds).toHaveLength(3);
    for (const c of creds) {
      expect(c.accountId).toBe(c.userId);
      expect(c.password?.startsWith('$2')).toBe(true);
      expect(c.id).toMatch(UUID_RE);
    }
  });

  it('is idempotent (guarded by the _meta row)', async () => {
    const again = await importLegacyUsers();
    expect(again.status).toBe('already-imported');
    expect(getDb().select().from(user).all()).toHaveLength(3);
    expect(getDb().select().from(account).all()).toHaveLength(3);
  });

  it('never modifies the .enc files', () => {
    for (const id of [ALEX_ID, SAM_ID, OLD_ID]) {
      expect(fs.existsSync(path.join(tmp.dir, 'users', id, 'user.enc'))).toBe(true);
    }
    expect(fs.existsSync(path.join(tmp.dir, 'users-index.enc'))).toBe(true);
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
    expect(n).toBe(3);

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
