'use server';

import * as fs from 'fs/promises';
import * as path from 'path';
import { updateTag } from 'next/cache';
import { headers } from 'next/headers';
import { isAPIError } from 'better-auth/api';
import { auth, getSessionAgeMs } from '@/lib/auth';
import { PASSKEY_REGISTRATION_MAX_SESSION_AGE_MS, RECENT_SIGN_IN_REQUIRED_MESSAGE } from '@/lib/auth/constants';
import { getAuth } from '@/lib/auth/server';
import type { ApiResponse, AccountDeletionBlocker, AccountDeletionPreflight, PasskeySummary } from '@/types';
import {
  setUserAvatar,
  hardDeleteUser,
  getLockoutRetryAfterSeconds,
  isAccountLocked,
  recordFailedLogin,
  recordSuccessfulLogin,
} from '@/lib/db/users';
import { getUserPasskeys } from '@/lib/db/passkeys';
import { getUserDir } from '@/lib/db/encryption';
import { changePasswordSchema, type ChangePasswordFormData } from '@/lib/schemas/auth.schema';
import { avatarDataUriSchema, avatarDataUriToBuffer } from '@/lib/schemas/user.schema';
import {
  cachedGetAccounts,
  cachedGetGoals,
  cachedGetBudgets,
  cachedGetTrips,
  cachedGetBankConnections,
  cachedGetSplitGroupsForUser,
  cachedGetSplitGroupSummary,
  cachedGetMortgagesForUser,
  cachedGetAllUsers,
} from '@/lib/db/cached';
import {
  deleteSplitGroup as dbDeleteSplitGroup,
  removeSplitGroupMember as dbRemoveSplitGroupMember,
  getSplitGroupById as dbGetSplitGroupById,
  getSplitGroupsForUser as dbGetSplitGroupsForUser,
  getSplitGroupSummary as dbGetSplitGroupSummary,
} from '@/lib/db/split-groups';
import {
  deleteMortgage as dbDeleteMortgage,
  removeMortgageMember as dbRemoveMortgageMember,
  getMortgageById as dbGetMortgageById,
  getMortgagesForUser as dbGetMortgagesForUser,
} from '@/lib/db/shared-mortgages';
import { getAllUsers as dbGetAllUsers } from '@/lib/db/users';
import { withGroupLock } from '@/lib/split-group-lock';
import { teardownBankConnection } from '@/lib/bank/teardown';

/** Change the current user's password after re-verifying the current one.
 * Better Auth's /change-password verifies the current password (bcrypt or
 * scrypt), stores a scrypt hash and revokes every other session; the fresh
 * session cookie for this browser is set by `nextCookies`. Passkeys are kept. */
export async function changeMyPassword(input: ChangePasswordFormData): Promise<ApiResponse<null>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Not authenticated' };

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Validation error' };

  // Per-user lockout on the current-password check: this action calls
  // auth.api directly (no Better Auth HTTP rate limit) and cookie-bearing
  // requests are exempt from the proxy limiter, so a stolen session cookie
  // could otherwise brute-force the password. Same map/limits as sign-in.
  const lockKey = passwordLockKey(session.user.id);
  if (await isAccountLocked(lockKey)) {
    return { success: false, error: lockedMessage(getLockoutRetryAfterSeconds(lockKey)) };
  }

  try {
    await getAuth().api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch (error) {
    if (isAPIError(error) && error.body?.code === 'INVALID_PASSWORD') {
      await recordFailedLogin(lockKey);
      if (await isAccountLocked(lockKey)) {
        return { success: false, error: lockedMessage(getLockoutRetryAfterSeconds(lockKey)) };
      }
      return { success: false, error: 'Current password is incorrect' };
    }
    if (isAPIError(error)) return { success: false, error: error.body?.message ?? 'Could not change password' };
    console.error('[account] change password failed:', error);
    return { success: false, error: 'Could not change password' };
  }
  await recordSuccessfulLogin(lockKey);
  return { success: true };
}

function passwordLockKey(userId: string): string {
  return `pw:${userId}`;
}

function lockedMessage(retryAfterSeconds: number): string {
  return `Too many incorrect passwords. Try again in ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} min.`;
}

/** The current user's registered passkeys (for Settings › Account). Rename,
 * delete and add go through the Better Auth passkey client. */
export async function listMyPasskeys(): Promise<ApiResponse<PasskeySummary[]>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Not authenticated' };
  return { success: true, data: getUserPasskeys(session.user.id) };
}

/** Set (data URI) or remove (null) the current user's own avatar. */
export async function updateMyAvatar(avatarDataUri: string | null): Promise<ApiResponse<null>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Not authenticated' };

  const parsed = avatarDataUriSchema.nullable().safeParse(avatarDataUri);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid image' };

  const image = parsed.data ? avatarDataUriToBuffer(parsed.data) : null;
  const updated = await setUserAvatar(session.user.id, image);
  if (!updated) return { success: false, error: 'User not found' };

  updateTag('users');
  return { success: true };
}

type SharedMembers = { members: Array<{ userId: string; role: string }> };

/** True when `userId` is an owner and nobody else in a multi-member entity is. */
function isSoleOwnerOfShared(entity: SharedMembers, userId: string): boolean {
  return (
    entity.members.length > 1 &&
    entity.members.some((m) => m.userId === userId && m.role === 'owner') &&
    !entity.members.some((m) => m.userId !== userId && m.role === 'owner')
  );
}

const splitSoleOwnerMessage = (name: string) => `Make another member an owner of "${name}", or delete the group first`;
const splitNotSettledMessage = (name: string) => `Settle up to €0 in "${name}" first`;
const mortgageSoleOwnerMessage = (name: string) => `Make another member an owner of "${name}", or delete it first`;

/** Shared preflight logic between the read-only check (getAccountDeletionPreflight)
 * and the server-side re-check inside deleteMyAccount — never trust the client's
 * copy of this at delete time. `fresh` reads the shared entities and users
 * uncached (the delete path must see what is on disk, not a cached copy). */
async function buildDeletionPreflight(
  userId: string,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<AccountDeletionPreflight> {
  const blockers: AccountDeletionBlocker[] = [];

  const [accounts, goals, budgets, trips, bankConnections, splitGroups, mortgages, allUsers] = await Promise.all([
    cachedGetAccounts(userId),
    cachedGetGoals(userId),
    cachedGetBudgets(userId),
    cachedGetTrips(userId),
    cachedGetBankConnections(userId),
    fresh ? dbGetSplitGroupsForUser(userId) : cachedGetSplitGroupsForUser(userId),
    fresh ? dbGetMortgagesForUser(userId) : cachedGetMortgagesForUser(userId),
    fresh ? dbGetAllUsers() : cachedGetAllUsers(),
  ]);

  let splitGroupsToLeave = 0;
  let splitGroupsToDelete = 0;
  for (const group of splitGroups) {
    const summary = fresh ? await dbGetSplitGroupSummary(group.id) : await cachedGetSplitGroupSummary(group.id);
    if ((summary.netByUserId[userId] ?? 0) !== 0) {
      blockers.push({ message: splitNotSettledMessage(group.name) });
    }
    if (group.members.length === 1) {
      splitGroupsToDelete += 1;
      continue;
    }
    splitGroupsToLeave += 1;
    if (isSoleOwnerOfShared(group, userId)) {
      blockers.push({ message: splitSoleOwnerMessage(group.name) });
    }
  }

  let mortgagesToLeave = 0;
  let mortgagesToDelete = 0;
  for (const mortgage of mortgages) {
    if (mortgage.members.length === 1) {
      mortgagesToDelete += 1;
      continue;
    }
    mortgagesToLeave += 1;
    if (isSoleOwnerOfShared(mortgage, userId)) {
      blockers.push({ message: mortgageSoleOwnerMessage(mortgage.name) });
    }
  }

  const me = allUsers.find((u) => u.id === userId);
  if (me?.role === 'admin') {
    const otherActiveAdmins = allUsers.some((u) => u.id !== userId && u.role === 'admin' && u.isActive);
    const otherActiveUsers = allUsers.some((u) => u.id !== userId && u.isActive);
    if (!otherActiveAdmins && otherActiveUsers) {
      blockers.push({ message: 'You are the only admin — promote another user to admin first' });
    }
  }

  return {
    blockers,
    summary: {
      accounts: accounts.length,
      goals: goals.length,
      budgets: budgets.length,
      trips: trips.length,
      bankConnections: bankConnections.length,
      splitGroupsToLeave,
      splitGroupsToDelete,
      mortgagesToLeave,
      mortgagesToDelete,
    },
  };
}

/** Read-only check surfaced by the "Delete account" dialog before the user
 * types their confirmation. Never mutates anything. */
export async function getAccountDeletionPreflight(): Promise<ApiResponse<AccountDeletionPreflight>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Not authenticated' };
  const preflight = await buildDeletionPreflight(session.user.id);
  return { success: true, data: preflight };
}

/** Wiping data or deleting the account needs a session younger than the
 * passkey-registration window, so a stolen long-lived cookie (or injected
 * script riding one) cannot erase everything in one call. Returns an error
 * message, or null when the session is recent enough. */
async function requireRecentSignIn(): Promise<string | null> {
  const ageMs = await getSessionAgeMs();
  if (ageMs === null || ageMs > PASSKEY_REGISTRATION_MAX_SESSION_AGE_MS) return RECENT_SIGN_IN_REQUIRED_MESSAGE;
  return null;
}

/** Permanently deletes the current user's account: leaves/deletes every shared
 * split group and mortgage they belong to, tears down bank connections
 * (best-effort consent revoke), then hard-deletes the user directory + index
 * entry. Irreversible — gated by typing the account's own email. */
export async function deleteMyAccount(input: { confirmationText: string }): Promise<ApiResponse<null>> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return { success: false, error: 'Not authenticated' };
  const userId = session.user.id;
  const userEmail = session.user.email;

  const reauth = await requireRecentSignIn();
  if (reauth) return { success: false, error: reauth };

  if (input.confirmationText.trim().toLowerCase() !== userEmail.trim().toLowerCase()) {
    return { success: false, error: 'Confirmation text does not match your account email' };
  }

  // Re-run the preflight server-side on uncached reads — never trust a
  // client-supplied "no blockers" or a cached group/mortgage list.
  const preflight = await buildDeletionPreflight(userId, { fresh: true });
  if (preflight.blockers.length > 0) {
    return { success: false, error: preflight.blockers.map((b) => b.message).join(' ') };
  }

  // Shared entities go first (they can still refuse); bank teardown and the
  // hard delete only run once every group/mortgage has been left or deleted.

  // (a) Split groups: under the group lock, re-read the doc + summary uncached
  // (same guards as leaveSplitGroup), then delete outright if the user is the
  // sole member, else leave. A group that changed since the preflight (e.g.
  // the other owner left) refuses instead of orphaning the group.
  type SplitOutcome = { ok: true } | { ok: false; error: string };
  const touchedSplitGroupMemberIds = new Set<string>();
  const splitGroups = await dbGetSplitGroupsForUser(userId);
  for (const listed of splitGroups) {
    const outcome = await withGroupLock(listed.id, async (): Promise<SplitOutcome> => {
      const group = await dbGetSplitGroupById(listed.id);
      if (!group || !group.members.some((m) => m.userId === userId)) return { ok: true };
      if (group.members.length === 1) {
        await dbDeleteSplitGroup(group.id);
        updateTag(`split-group:${group.id}:expense-chunks`);
      } else {
        const summary = await dbGetSplitGroupSummary(group.id);
        if ((summary.netByUserId[userId] ?? 0) !== 0) return { ok: false, error: splitNotSettledMessage(group.name) };
        if (isSoleOwnerOfShared(group, userId)) return { ok: false, error: splitSoleOwnerMessage(group.name) };
        await dbRemoveSplitGroupMember(group.id, userId);
      }
      for (const m of group.members) touchedSplitGroupMemberIds.add(m.userId);
      updateTag(`split-group:${group.id}`);
      updateTag(`split-group:${group.id}:summary`);
      updateTag(`split-group:${group.id}:expenses`);
      return { ok: true };
    });
    if (!outcome.ok) {
      for (const uid of touchedSplitGroupMemberIds) updateTag(`user:${uid}:split-groups`);
      return { success: false, error: outcome.error };
    }
  }

  // (b) Shared mortgages: same rule, re-read uncached right before the write.
  const touchedMortgageMemberIds = new Set<string>();
  const mortgages = await dbGetMortgagesForUser(userId);
  for (const listed of mortgages) {
    const mortgage = await dbGetMortgageById(listed.id);
    if (!mortgage || !mortgage.members.some((m) => m.userId === userId)) continue;
    if (isSoleOwnerOfShared(mortgage, userId)) {
      for (const uid of touchedSplitGroupMemberIds) updateTag(`user:${uid}:split-groups`);
      for (const uid of touchedMortgageMemberIds) updateTag(`user:${uid}:mortgages`);
      return { success: false, error: mortgageSoleOwnerMessage(mortgage.name) };
    }
    for (const m of mortgage.members) touchedMortgageMemberIds.add(m.userId);
    if (mortgage.members.length === 1) {
      await dbDeleteMortgage(mortgage.id);
    } else {
      await dbRemoveMortgageMember(mortgage.id, userId);
    }
    updateTag(`mortgage:${mortgage.id}`);
  }

  // (c) Bank teardown — best-effort revoke, never fails the deletion.
  const connections = await cachedGetBankConnections(userId);
  for (const connection of connections) {
    try {
      await teardownBankConnection(userId, connection);
    } catch (err) {
      console.error('[account] bank teardown failed during account deletion (continuing):', err);
    }
  }

  // (d) Hard delete: remove from the users index, then rm the whole user dir.
  await hardDeleteUser(userId);

  // (e) Cache-tag fan-out.
  updateTag(`user:${userId}`);
  updateTag('users');
  for (const uid of touchedSplitGroupMemberIds) updateTag(`user:${uid}:split-groups`);
  for (const uid of touchedMortgageMemberIds) updateTag(`user:${uid}:mortgages`);

  return { success: true };
}

// Dirs wiped by "Start fresh" — every OWNED financial data dir. Deliberately
// excludes preferences.enc and the avatar, and never touches shared split-groups /
// shared-mortgages (those live outside the user dir entirely).
const RESET_DIRS = ['accounts', 'investments', 'receivables', 'debts', 'goals', 'budgets', 'trips', 'reconciliation', 'bank'];

/** "Start fresh": wipes all of the current user's own financial data (incl.
 * disconnecting + revoking bank consents) but keeps the account itself,
 * login, and preferences. Shared split groups/mortgages are never touched. */
export async function resetMyData(): Promise<ApiResponse<null>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Not authenticated' };
  const userId = session.user.id;

  const reauth = await requireRecentSignIn();
  if (reauth) return { success: false, error: reauth };

  const connections = await cachedGetBankConnections(userId);
  for (const connection of connections) {
    try {
      await teardownBankConnection(userId, connection);
    } catch (err) {
      console.error('[account] bank teardown failed during data reset (continuing):', err);
    }
  }

  const userDir = getUserDir(userId);
  await Promise.all(RESET_DIRS.map((d) => fs.rm(path.join(userDir, d), { recursive: true, force: true })));

  updateTag(`user:${userId}`);
  return { success: true };
}
