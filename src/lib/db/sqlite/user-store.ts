import * as fs from 'fs';
import * as path from 'path';
import { sql } from 'drizzle-orm';
import { getDataDir } from '../encryption';
import { getDb } from './client';
import { user } from './schema';
import { getSetupFailure } from './setup-state';

/**
 * Consistency gate between the SQLCipher `user` table and the per-user data
 * dirs (`<DATA_DIR>/users/<id>/`, keyed by the user's UUID).
 *
 * User dirs on disk while the DB has no user row at all (soft-deleted
 * included) mean the DB does not belong to this data: a lost or re-created
 * `sampolio.db`, typically after a wrong ENCRYPTION_KEY. Auth then fails
 * CLOSED (bootstrap.ts) instead of letting the next sign-up become the first
 * admin over existing financial data. The fix is restoring
 * `snapshots/sampolio.db` (docs/operations.md), not re-creating users.
 */

/** Thrown by `verifyUserStore()`; bootstrap.ts turns it into a setup failure. */
export class UserStoreError extends Error {
  constructor(message: string) {
    super(`User store check failed: ${message}`);
    this.name = 'UserStoreError';
  }
}

export function tombstoneEmail(userId: string): string {
  return `deleted+${userId}@invalid`;
}

function countUserRows(): number {
  const row = getDb().select({ n: sql<number>`count(*)` }).from(user).get();
  return row?.n ?? 0;
}

/** Number of dirs under `<DATA_DIR>/users/`. Synchronous: called from auth
 * hooks. A missing `users/` is 0; any other read error propagates, so the
 * caller fails instead of treating unreadable data as absent. */
export function countUserDataDirs(): number {
  try {
    return fs
      .readdirSync(path.join(getDataDir(), 'users'), { withFileTypes: true })
      .filter((e) => e.isDirectory()).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

/** Boot-time check (bootstrap.ts). Throws `UserStoreError` when user data
 * dirs exist but the DB has no users. */
export function verifyUserStore(): { users: number; dataDirs: number } {
  const users = countUserRows();
  const dataDirs = countUserDataDirs();
  if (users === 0 && dataDirs > 0) {
    throw new UserStoreError(
      `users/ has ${dataDirs} data dir(s) but the account database has no users (lost or wrong sampolio.db?); restore snapshots/sampolio.db`,
    );
  }
  return { users, dataDirs };
}

/**
 * Fail-closed gate for sign-up and session creation: false when this
 * process's bootstrap failed, or (also without the in-process flag) when
 * user data dirs exist but the DB has no users.
 */
export function isAuthSetupComplete(): boolean {
  if (getSetupFailure()) return false;
  return countUserRows() > 0 || countUserDataDirs() === 0;
}

/**
 * The first-user rule (bypasses the self-signup setting, becomes admin) only
 * applies to a genuinely fresh install: setup complete, no user rows at all
 * (soft-deleted included) and no user data dirs on disk.
 */
export function isFirstUserSetup(): boolean {
  if (getSetupFailure()) return false;
  return countUserRows() === 0 && countUserDataDirs() === 0;
}
