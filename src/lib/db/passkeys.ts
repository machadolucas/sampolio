import { and, desc, eq, sql } from 'drizzle-orm';
import { getAuthenticatorName } from '@better-auth/passkey';
import type { PasskeySummary } from '@/types';
import { DEFAULT_PASSKEY_NAME } from '@/lib/passkey-name';
import { getDb } from './sqlite/client';
import { passkey } from './sqlite/schema';

// Read/cleanup side of the `passkey` table. Registration, sign-in, rename and
// self-service delete go through Better Auth's passkey plugin endpoints
// (authClient.passkey.* / authClient.signIn.passkey); these helpers back the
// server actions that list passkeys and the admin "Remove passkeys" action.

type PasskeyRow = typeof passkey.$inferSelect;

export { DEFAULT_PASSKEY_NAME };

/** Label for a passkey: stored name, else AAGUID provider, else "Passkey". */
export function passkeyLabel(row: Pick<PasskeyRow, 'name' | 'aaguid'>): string {
  return row.name?.trim() || getAuthenticatorName(row.aaguid) || DEFAULT_PASSKEY_NAME;
}

function toSummary(row: PasskeyRow): PasskeySummary {
  return {
    id: row.id,
    name: passkeyLabel(row),
    providerName: getAuthenticatorName(row.aaguid),
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    createdAt: row.createdAt?.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString(),
  };
}

export function getUserPasskeys(userId: string): PasskeySummary[] {
  return getDb()
    .select()
    .from(passkey)
    .where(eq(passkey.userId, userId))
    .orderBy(desc(passkey.createdAt))
    .all()
    .map(toSummary);
}

/** userId → number of passkeys (users without passkeys are absent). */
export function countPasskeysByUser(): Record<string, number> {
  const rows = getDb()
    .select({ userId: passkey.userId, n: sql<number>`count(*)` })
    .from(passkey)
    .groupBy(passkey.userId)
    .all();
  return Object.fromEntries(rows.map((r) => [r.userId, r.n]));
}

/** Remove every passkey of a user. Returns how many were deleted. */
export function deleteUserPasskeys(userId: string): number {
  return getDb().delete(passkey).where(eq(passkey.userId, userId)).run().changes;
}

/**
 * Stamp `lastUsedAt` on the passkey a sign-in used. Called by the
 * `/passkey/verify-authentication` after-hook (src/lib/auth/server.ts) only
 * once a session was created; scoped to that user as well as the credential.
 * Returns the number of rows stamped.
 */
export function recordPasskeySignIn({ userId, credentialId, at = new Date() }: { userId: string; credentialId: string; at?: Date }): number {
  return getDb()
    .update(passkey)
    .set({ lastUsedAt: at })
    .where(and(eq(passkey.credentialID, credentialId), eq(passkey.userId, userId)))
    .run().changes;
}
