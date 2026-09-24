import * as fs from 'fs/promises';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDataDir, readEncryptedFile } from '../encryption';
import { getDb, getSqlite } from './client';
import { account, meta, user } from './schema';

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

async function readLegacyUsers(): Promise<{ users: LegacyUser[]; indexIds: Set<string> }> {
  const dataDir = getDataDir();
  const index = await readEncryptedFile<LegacyUsersIndex>(path.join(dataDir, 'users-index.enc'));
  const indexIds = new Set((index?.users ?? []).map((u) => u.id));

  let dirs: string[] = [];
  try {
    const entries = await fs.readdir(path.join(dataDir, 'users'), { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const users: LegacyUser[] = [];
  for (const dir of dirs.sort()) {
    // A decrypt failure throws (wrong ENCRYPTION_KEY) and aborts the import.
    const legacy = await readEncryptedFile<LegacyUser>(path.join(dataDir, 'users', dir, 'user.enc'));
    if (!legacy?.id) continue;
    users.push(legacy);
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
      const createdAt = toDate(legacy.createdAt, now);
      const updatedAt = toDate(legacy.updatedAt, createdAt);
      const deleted = !inIndex;
      const inserted = db
        .insert(user)
        .values({
          id: legacy.id,
          name: legacy.name || legacy.email,
          email: deleted ? tombstoneEmail(legacy.id) : legacy.email.trim().toLowerCase(),
          emailVerified: false,
          createdAt,
          updatedAt,
          role: legacy.role === 'admin' ? 'admin' : 'user',
          isActive: deleted ? false : legacy.isActive !== false,
          deletedAt: deleted ? updatedAt : null,
          avatarVersion: legacy.avatarVersion ?? null,
        })
        .onConflictDoNothing()
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
