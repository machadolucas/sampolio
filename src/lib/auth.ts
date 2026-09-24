import { cache } from 'react';
import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth/server';
import type { UserRole } from '@/types';

/**
 * Server-side session accessor used by every server action, route handler and
 * server component (`const session = await auth()`). It keeps the pre-4.0
 * Auth.js shape so the ~150 call sites (and the tests that
 * `vi.mock('@/lib/auth')`) are unchanged.
 *
 * Backed by Better Auth DB sessions (src/lib/auth/server.ts). Because there is
 * no cookie cache, every call reads the session + user rows, so an admin
 * deactivation or soft delete takes effect on the user's very next request.
 * React `cache()` dedupes the lookup within one request.
 */

export interface AppSession {
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  };
}

type SessionUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  isActive?: boolean | null;
  deletedAt?: Date | string | null;
};

const getRequestSession = cache(async () => {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

export async function auth(): Promise<AppSession | null> {
  const result = await getRequestSession();
  if (!result?.user) return null;
  const user = result.user as SessionUser;
  if (user.isActive === false || user.deletedAt) return null;
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role === 'admin' ? 'admin' : 'user',
    },
  };
}
