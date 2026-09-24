import { cache } from 'react';
import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth/server';
import { toAppSession, type AppSession } from '@/lib/auth/session';
import { getSetupFailure } from '@/lib/db/sqlite/setup-state';

export type { AppSession };

/**
 * Server-side session accessor used by every server action, route handler and
 * server component (`const session = await auth()`). It keeps the pre-4.0
 * Auth.js shape so the ~150 call sites (and the tests that
 * `vi.mock('@/lib/auth')`) are unchanged.
 *
 * Backed by Better Auth DB sessions (src/lib/auth/server.ts). Because there is
 * no cookie cache, every call reads the session + user rows, so an admin
 * deactivation or soft delete takes effect on the user's very next request.
 * React `cache()` dedupes the lookup within one request. The validity rule
 * itself is `toAppSession` (src/lib/auth/session.ts), shared with the proxy.
 */

const getRequestSession = cache(async () => {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

export async function auth(): Promise<AppSession | null> {
  if (getSetupFailure()) return null; // fail closed without touching the DB (bootstrap.ts)
  return toAppSession(await getRequestSession());
}
