import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { and, eq, ne, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDataDir, readEncryptedFile } from '../encryption';
import { getDb, getSqlite } from './client';
import { account, meta, user } from './schema';
import { getSetupFailure } from './setup-state';

/**
 * One-shot import of the pre-4.0 file-based users (`users-index.enc` +
 * `users/<id>/user.enc`) into the SQLCipher `user` + `account` tables.
 *
 * - Same UUIDs (every per-user `.enc` path and shared-member reference keys on
 *   them), role, active flag, timestamps and `avatarVersion`.
 * - The bcrypt `passwordHash` becomes a `credential` account row
 *   (`accountId` = user id, as Better Auth's sign-in expects). Better Auth
 *   verifies it via the bcrypt branch in `src/lib/auth/server.ts` and rehashes
 *   it to scrypt on the first successful sign-in.
 * - A user dir that is NOT in the index was soft-deleted by the old admin
 *   "delete" (which only dropped the index entry). It is imported as deleted:
 *   `deletedAt` set, `isActive=false`, email rewritten to a tombstone so the
 *   address stays reusable.
 * - The `.enc` user files are never modified or removed — they stay on disk
 *   as the rollback path for the previous release.
 *
 * Guarded by the `_meta` row `legacy-users-imported`; the inserts and the
 * marker commit in one transaction, so a failed run retries on next boot.
 */

export const LEGACY_IMPORT_META_KEY = 'legacy-users-imported';

interface LegacyUser {
  id: string;
  email: string;
  name: string;
  passwordHash?: string;
  role?: 'admin' | 'user';
  isActive?: boolean;
  avatarVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface LegacyUsersIndex {
  users: { id: string; email: string }[];
}

export interface LegacyImportResult {
  status: 'imported' | 'already-imported';
  imported: number;
  softDeleted: number;
}

export function tombstoneEmail(userId: string): string {
  return `deleted+${userId}@invalid`;
}

function toDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** Thrown for any inconsistency in the legacy files; the import aborts and
 * auth fails closed (see bootstrap.ts). */
export class LegacyImportError extends Error {
  constructor(message: string) {
    super(`Legacy user import aborted: ${message}`);
    this.name = 'LegacyImportError';
  }
}

async function listUserDirs(dataDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(dataDir, 'users'), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Whether any pre-4.0 user data is on disk (`users-index.enc` or a
 * `users/*` dir). Synchronous: called from auth hooks. */
export function hasLegacyUserData(): boolean {
  const dataDir = getDataDir();
  if (fsSync.existsSync(path.join(dataDir, 'users-index.enc'))) return true;
  try {
    return fsSync.readdirSync(path.join(dataDir, 'users'), { withFileTypes: true }).some((e) => e.isDirectory());
  } catch {
    return false;
  }
}

async function readLegacyUsers(): Promise<{ users: LegacyUser[]; indexIds: Set<string> }> {
  const dataDir = getDataDir();
  const dirs = await listUserDirs(dataDir);

  let index: LegacyUsersIndex | null;
  try {
    index = await readEncryptedFile<LegacyUsersIndex>(path.join(dataDir, 'users-index.enc'));
  } catch (error) {
    throw new LegacyImportError(`users-index.enc is unreadable (wrong ENCRYPTION_KEY?): ${(error as Error).message}`);
  }
  if (!index && dirs.length > 0) {
    // Importing every dir as "not in the index" would soft-delete everyone.
    throw new LegacyImportError(`users/ has ${dirs.length} user dir(s) but users-index.enc is missing`);
  }
  if (index && !Array.isArray(index.users)) {
    throw new LegacyImportError('users-index.enc has no users array');
  }
  const indexIds = new Set((index?.users ?? []).map((u) => u.id));

  const users: LegacyUser[] = [];
  for (const dir of dirs) {
    let legacy: LegacyUser | null;
    try {
      legacy = await readEncryptedFile<LegacyUser>(path.join(dataDir, 'users', dir, 'user.enc'));
    } catch (error) {
      throw new LegacyImportError(`users/${dir}/user.enc is unreadable (wrong ENCRYPTION_KEY or corrupt): ${(error as Error).message}`);
    }
    if (!legacy) {
      if (indexIds.has(dir)) throw new LegacyImportError(`users-index.enc lists ${dir} but users/${dir}/user.enc is missing`);
      console.warn(`[db] legacy import: users/${dir} has no user.enc — skipped`);
      continue;
    }
    if (legacy.id !== dir) {
      throw new LegacyImportError(`users/${dir}/user.enc carries a different id (${String(legacy.id)})`);
    }
    if (indexIds.has(dir) && (typeof legacy.email !== 'string' || !legacy.email.trim())) {
      throw new LegacyImportError(`users/${dir}/user.enc has no email`);
    }
    users.push(legacy);
  }

  for (const id of indexIds) {
    if (!users.some((u) => u.id === id)) {
      throw new LegacyImportError(`users-index.enc lists ${id} but users/${id}/ does not exist`);
    }
  }

  // Active (indexed) users need unique emails; soft-deleted ones get tombstones.
  const seen = new Map<string, string>();
  for (const u of users) {
    if (!indexIds.has(u.id)) continue;
    const email = u.email.trim().toLowerCase();
    const other = seen.get(email);
    if (other) throw new LegacyImportError(`users ${other} and ${u.id} share the email ${email}`);
    seen.set(email, u.id);
  }
  return { users, indexIds };
}

export async function importLegacyUsers(): Promise<LegacyImportResult> {
  const db = getDb();
  const done = db.select().from(meta).where(eq(meta.key, LEGACY_IMPORT_META_KEY)).get();
  if (done) return { status: 'already-imported', imported: 0, softDeleted: 0 };

  const { users, indexIds } = await readLegacyUsers();
  const now = new Date();
  let imported = 0;
  let softDeleted = 0;

  getSqlite().transaction(() => {
    // Re-check inside the write transaction (two processes booting at once).
    if (db.select().from(meta).where(eq(meta.key, LEGACY_IMPORT_META_KEY)).get()) return;

    for (const legacy of users) {
      const inIndex = indexIds.has(legacy.id);
      if (inIndex) {
        const email = legacy.email.trim().toLowerCase();
        const clash = db
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.email, email), ne(user.id, legacy.id)))
          .get();
        if (clash) throw new LegacyImportError(`email ${email} of ${legacy.id} already belongs to DB user ${clash.id}`);
      }
      const createdAt = toDate(legacy.createdAt, now);
      const updatedAt = toDate(legacy.updatedAt, createdAt);
      const deleted = !inIndex;
      const inserted = db
        .insert(user)
        .values({
          id: legacy.id,
          name: legacy.name || legacy.email || 'Deleted user',
          email: deleted ? tombstoneEmail(legacy.id) : legacy.email.trim().toLowerCase(),
          emailVerified: false,
          createdAt,
          updatedAt,
          role: legacy.role === 'admin' ? 'admin' : 'user',
          isActive: deleted ? false : legacy.isActive !== false,
          deletedAt: deleted ? updatedAt : null,
          avatarVersion: legacy.avatarVersion ?? null,
        })
        .onConflictDoNothing({ target: user.id })
        .run();
      if (inserted.changes === 0) continue;

      if (legacy.passwordHash) {
        db.insert(account)
          .values({
            id: uuidv4(),
            accountId: legacy.id,
            providerId: 'credential',
            userId: legacy.id,
            password: legacy.passwordHash,
            createdAt,
            updatedAt,
          })
          .run();
      }
      imported += 1;
      if (deleted) softDeleted += 1;
    }

    db.insert(meta)
      .values({
        key: LEGACY_IMPORT_META_KEY,
        value: JSON.stringify({ imported, softDeleted, at: now.toISOString() }),
        updatedAt: now,
      })
      .run();
  })();

  return { status: 'imported', imported, softDeleted };
}

/** Whether the one-shot import has completed (its _meta marker exists). */
export function isLegacyImportDone(): boolean {
  return !!getDb().select({ key: meta.key }).from(meta).where(eq(meta.key, LEGACY_IMPORT_META_KEY)).get();
}

/**
 * Fail-closed gate for sign-up and session creation: false when this
 * process's bootstrap failed, or when legacy `.enc` user data exists but the
 * import marker is missing (the import never completed).
 */
export function isAuthSetupComplete(): boolean {
  if (getSetupFailure()) return false;
  if (isLegacyImportDone()) return true;
  return !hasLegacyUserData();
}

/**
 * The first-user rule (bypasses the self-signup setting, becomes admin) only
 * applies to a genuinely fresh install: setup complete, no user rows at all
 * (soft-deleted included) and no legacy `.enc` user data on disk.
 */
export function isFirstUserSetup(): boolean {
  if (!isAuthSetupComplete()) return false;
  const row = getDb().select({ n: sql<number>`count(*)` }).from(user).get();
  if ((row?.n ?? 0) > 0) return false;
  return !hasLegacyUserData();
}
