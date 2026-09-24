'use client';

import { useMemo } from 'react';
import { createAuthClient } from 'better-auth/react';
import { passkeyClient } from '@better-auth/passkey/client';
import type { UserRole } from '@/types';

/**
 * Browser-side Better Auth client (same-origin `/api/auth`). Use
 * `authClient.signIn.email` / `authClient.signIn.passkey` / `authClient.signOut`
 * and `authClient.passkey.*` directly; they resolve to `{ data, error }` and
 * never throw for HTTP errors.
 */
export const authClient = createAuthClient({
  plugins: [passkeyClient()],
});

export interface ClientSession {
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  };
}

/**
 * Drop-in for the old `next-auth/react` `useSession()`: `{ data: session }` in
 * the pre-4.0 shape (`session.user.{id,email,name,role}`), `undefined` while
 * loading, `null` when signed out. No provider needed — Better Auth shares one
 * session store across every caller.
 */
export function useSession(): { data: ClientSession | null | undefined; status: 'loading' | 'authenticated' | 'unauthenticated' } {
  const { data, isPending } = authClient.useSession();
  const user = data?.user as (NonNullable<typeof data>['user'] & { role?: string | null }) | undefined;
  const id = user?.id;
  const email = user?.email;
  const name = user?.name;
  const role: UserRole = user?.role === 'admin' ? 'admin' : 'user';
  // Memoized on the identity fields so callers that list `session` in effect
  // deps don't re-run on every render.
  const session = useMemo<ClientSession | null>(
    () => (id && email !== undefined ? { user: { id, email, name: name ?? '', role } } : null),
    [id, email, name, role],
  );
  if (isPending && !data) return { data: undefined, status: 'loading' };
  if (!session) return { data: null, status: 'unauthenticated' };
  return { data: session, status: 'authenticated' };
}
