import { getSetupFailure } from '@/lib/db/sqlite/setup-state';
import type { UserRole } from '@/types';

/**
 * The one rule for "is this Better Auth session usable", shared by `auth()`
 * (src/lib/auth.ts, server components/actions) and the proxy's auth-page
 * check (src/proxy.ts). Keeping both on this function is what stops them from
 * disagreeing — a disagreement is exactly what would bounce a browser between
 * a protected page and /auth/signin forever.
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

/** Map a `getSession()` result to the app's session shape, or null when the
 * session must not be honoured (no row, deactivated or soft-deleted user,
 * failed auth bootstrap). */
export function toAppSession(result: { user?: unknown } | null | undefined): AppSession | null {
  if (getSetupFailure()) return null; // fail closed (src/lib/db/sqlite/bootstrap.ts)
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
