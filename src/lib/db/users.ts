import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import type { User, UserRole, PublicUser } from '@/types';
import { ensureDir, getUserDir } from './encryption';
import { getDb } from './sqlite/client';
import { account, session, user as userTable } from './sqlite/schema';
import { tombstoneEmail } from './sqlite/legacy-import';

// Users live in the SQLCipher DB (`src/lib/db/sqlite/`), managed by Better
// Auth (`src/lib/auth/server.ts`). These functions keep the pre-4.0 file-DB
// signatures so every caller (actions, bank scheduler, cached.ts) is
// unchanged. Password hashes live in the `credential` account row, never on
// the User type.

type UserRow = typeof userTable.$inferSelect;

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    avatarVersion: row.avatarVersion ?? undefined,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Active-or-inactive, NOT deleted user by email (case-insensitive). */
export async function findUserByEmail(email: string): Promise<User | null> {
  const row = getDb()
    .select()
    .from(userTable)
    .where(and(eq(userTable.email, email.trim().toLowerCase()), isNull(userTable.deletedAt)))
    .get();
  return row ? toUser(row) : null;
}

/** Any user by id, including soft-deleted ones (matches the old file read). */
export async function findUserById(id: string): Promise<User | null> {
  const row = getDb().select().from(userTable).where(eq(userTable.id, id)).get();
  return row ? toUser(row) : null;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    avatarUrl: avatarUrlFor(user),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** URL of the user's avatar (served by /api/avatars/[userId]) with a
 * version cache-buster, or undefined when the user has no avatar. */
export function avatarUrlFor(user: Pick<User, 'id' | 'avatarVersion'>): string | undefined {
  return user.avatarVersion ? `/api/avatars/${user.id}?v=${user.avatarVersion}` : undefined;
}

const AVATAR_FILE = 'avatar.webp';

/** Absolute path of a user's avatar image. The file is deliberately stored
 * UNENCRYPTED (unlike everything else in the data dir): it is low-sensitivity
 * and plain binary lets the /api/avatars route stream it with HTTP caching and
 * zero decryption work. */
export function getAvatarPath(userId: string): string {
  return path.join(getUserDir(userId), AVATAR_FILE);
}

/** Write (or, with null, delete) a user's avatar image and bump
 * avatarVersion. Returns the updated user, or null if the user doesn't exist. */
export async function setUserAvatar(userId: string, image: Buffer | null): Promise<User | null> {
  const user = await findUserById(userId);
  if (!user) {
    return null;
  }

  const avatarPath = getAvatarPath(userId);
  if (image) {
    await ensureDir(getUserDir(userId));
    await fs.writeFile(avatarPath, image);
  } else {
    await fs.rm(avatarPath, { force: true });
  }

  const row = getDb()
    .update(userTable)
    .set({ avatarVersion: image ? (user.avatarVersion ?? 0) + 1 : null, updatedAt: new Date() })
    .where(eq(userTable.id, userId))
    .returning()
    .get();
  return row ? toUser(row) : null;
}

/** Number of non-deleted users (the first-user-becomes-admin rule). */
export function countUsers(): number {
  const row = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(userTable)
    .where(isNull(userTable.deletedAt))
    .get();
  return row?.n ?? 0;
}

/** Admin-side user creation (no session). Self sign-up goes through Better
 * Auth's /sign-up/email instead (src/lib/actions/auth.ts). */
export async function createUser(
  email: string,
  password: string,
  name: string,
  role: UserRole = 'user'
): Promise<User> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = getDb().select({ id: userTable.id }).from(userTable).where(eq(userTable.email, normalizedEmail)).get();
  if (existing) {
    throw new Error('User with this email already exists');
  }

  const id = uuidv4();
  const now = new Date();
  const passwordHash = await hashPassword(password);
  const db = getDb();
  const row = db.transaction((tx) => {
    const isFirstUser = countUsers() === 0;
    const created = tx
      .insert(userTable)
      .values({
        id,
        email: normalizedEmail,
        name,
        emailVerified: false,
        role: isFirstUser ? 'admin' : role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    tx.insert(account)
      .values({ id: uuidv4(), accountId: id, providerId: 'credential', userId: id, password: passwordHash, createdAt: now, updatedAt: now })
      .run();
    return created;
  });

  await ensureDir(getUserDir(id));
  return toUser(row);
}

/** Delete every session of a user (they are signed out on their next request). */
export function revokeUserSessions(userId: string): number {
  return getDb().delete(session).where(eq(session.userId, userId)).run().changes;
}

export async function updateUser(
  userId: string,
  updates: Partial<Pick<User, 'name' | 'email' | 'role' | 'isActive'>>
): Promise<User | null> {
  const set: Partial<typeof userTable.$inferInsert> = { updatedAt: new Date() };
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.email !== undefined) set.email = updates.email.trim().toLowerCase();
  if (updates.role !== undefined) set.role = updates.role;
  if (updates.isActive !== undefined) set.isActive = updates.isActive;

  const row = getDb().update(userTable).set(set).where(eq(userTable.id, userId)).returning().get();
  if (!row) {
    return null;
  }
  // Deactivation takes effect immediately: auth() re-checks isActive on every
  // request, and dropping the sessions also stops the cookie at the proxy.
  if (updates.isActive === false) {
    revokeUserSessions(userId);
  }
  return toUser(row);
}

/** Set a new password (admin reset). Upserts the credential account and
 * signs the user out everywhere. Passkeys are kept. */
export async function changePassword(userId: string, newPassword: string): Promise<boolean> {
  const user = await findUserById(userId);
  if (!user) {
    return false;
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();
  const db = getDb();
  db.transaction((tx) => {
    const updated = tx
      .update(account)
      .set({ password: passwordHash, updatedAt: now })
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
      .run();
    if (updated.changes === 0) {
      tx.insert(account)
        .values({ id: uuidv4(), accountId: userId, providerId: 'credential', userId, password: passwordHash, createdAt: now, updatedAt: now })
        .run();
    }
    tx.delete(session).where(eq(session.userId, userId)).run();
  });
  return true;
}

/** All non-deleted users (active and inactive) — what the old users index held. */
export async function getAllUsers(): Promise<User[]> {
  const rows = getDb().select().from(userTable).where(isNull(userTable.deletedAt)).orderBy(userTable.createdAt).all();
  return rows.map(toUser);
}

/** Admin soft delete: keeps the row and the data dir, marks the user deleted
 * + inactive, frees the email (tombstone) and signs them out. */
export async function deleteUser(userId: string): Promise<boolean> {
  const now = new Date();
  const row = getDb()
    .update(userTable)
    .set({ deletedAt: now, isActive: false, email: tombstoneEmail(userId), updatedAt: now })
    .where(and(eq(userTable.id, userId), isNull(userTable.deletedAt)))
    .returning()
    .get();
  if (!row) {
    return false;
  }
  revokeUserSessions(userId);
  return true;
}

/** Permanent, irreversible deletion: removes the user row (FK cascade drops
 * sessions, accounts and passkeys) AND recursively deletes their entire data
 * directory. Unlike `deleteUser` (a soft delete that preserves files for admin
 * purposes), this is for account self-deletion — the caller must have already
 * torn down any shared entities (split groups / mortgages) the user belongs to. */
export async function hardDeleteUser(userId: string): Promise<boolean> {
  getDb().delete(userTable).where(eq(userTable.id, userId)).run();

  const userDir = getUserDir(userId);
  await fs.rm(userDir, { recursive: true, force: true });

  return true;
}

// ==================== Account Lockout for Brute Force Protection ====================

// In-memory store for failed login attempts (resets on server restart)
// For production with multiple instances, use Redis
const failedLoginAttempts = new Map<string, { count: number; lastAttempt: number; lockedUntil: number | null }>();

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes - reset count after this

export async function isAccountLocked(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase();
  const record = failedLoginAttempts.get(normalizedEmail);

  if (!record) {
    return false;
  }

  // Check if lockout has expired
  if (record.lockedUntil && Date.now() > record.lockedUntil) {
    failedLoginAttempts.delete(normalizedEmail);
    return false;
  }

  return record.lockedUntil !== null;
}

/** Seconds until the lockout for `email` expires; 0 when not locked. */
export function getLockoutRetryAfterSeconds(email: string): number {
  const record = failedLoginAttempts.get(email.toLowerCase());
  if (!record?.lockedUntil) return 0;
  const remaining = record.lockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export async function recordFailedLogin(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  const now = Date.now();
  const record = failedLoginAttempts.get(normalizedEmail);

  if (!record || now - record.lastAttempt > ATTEMPT_WINDOW) {
    // Reset count if first attempt or window has passed
    failedLoginAttempts.set(normalizedEmail, {
      count: 1,
      lastAttempt: now,
      lockedUntil: null,
    });
    return;
  }

  const newCount = record.count + 1;

  if (newCount >= MAX_FAILED_ATTEMPTS) {
    // Lock the account
    failedLoginAttempts.set(normalizedEmail, {
      count: newCount,
      lastAttempt: now,
      lockedUntil: now + LOCKOUT_DURATION,
    });
    console.warn(`Account locked due to too many failed attempts: ${normalizedEmail}`);
  } else {
    failedLoginAttempts.set(normalizedEmail, {
      count: newCount,
      lastAttempt: now,
      lockedUntil: null,
    });
  }
}

export async function recordSuccessfulLogin(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  // Clear failed attempts on successful login
  failedLoginAttempts.delete(normalizedEmail);
}

// Clean up old entries periodically (unref'd so it never keeps a script or
// test process alive).
setInterval(() => {
  const now = Date.now();
  for (const [email, record] of failedLoginAttempts.entries()) {
    // Remove entries that are both unlocked and outside the attempt window
    if (!record.lockedUntil && now - record.lastAttempt > ATTEMPT_WINDOW) {
      failedLoginAttempts.delete(email);
    }
    // Remove entries where lockout has expired
    if (record.lockedUntil && now > record.lockedUntil) {
      failedLoginAttempts.delete(email);
    }
  }
}, 5 * 60 * 1000).unref(); // Clean up every 5 minutes
