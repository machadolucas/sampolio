import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { nextCookies } from 'better-auth/next-js';
import { passkey, getAuthenticatorName } from '@better-auth/passkey';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/sqlite/client';
import * as schema from '@/lib/db/sqlite/schema';
import { getUserDir, ensureDir } from '@/lib/db/encryption';
import { isSelfSignupEnabled } from '@/lib/db/app-settings';
import {
  countUsers,
  getLockoutRetryAfterSeconds,
  isAccountLocked,
  recordFailedLogin,
  recordSuccessfulLogin,
} from '@/lib/db/users';
import { DEFAULT_PASSKEY_NAME, touchPasskeyByCredentialId } from '@/lib/db/passkeys';
import { passwordPolicySchema, signUpNameSchema } from '@/lib/schemas/auth.schema';
import { PASSKEY_REAUTH_REQUIRED, PASSKEY_REGISTRATION_MAX_SESSION_AGE_MS } from './constants';

export { PASSKEY_REAUTH_REQUIRED, PASSKEY_REGISTRATION_MAX_SESSION_AGE_MS };

/**
 * Better Auth instance (lazy — building it opens nothing, but the adapter's
 * first query opens the SQLCipher DB, which must never happen at import time
 * because `next build` evaluates server modules).
 *
 * Design notes (see docs/architecture.md §Auth):
 * - Sessions are DB rows, 30 days, refreshed daily. **No cookie cache**: a
 *   signed cache cookie would keep a revoked/deactivated session alive until
 *   it expired. `auth()` in src/lib/auth.ts dedupes per request instead.
 * - `freshAge: 0`: the passkey plugin guards registration with
 *   `freshSessionMiddleware`; 0 disables that age gate (it would also gate
 *   /list-sessions, /unlink-account, /delete-user). Instead `hooks.before`
 *   refuses /passkey/generate-register-options unless the session is younger
 *   than PASSKEY_REGISTRATION_MAX_SESSION_AGE_MS (10 min), so a stolen older
 *   cookie cannot enroll a passkey that outlives a password change.
 * - Passwords: new hashes are Better Auth's scrypt. Legacy bcrypt hashes
 *   imported from the `.enc` user files verify through bcrypt and are
 *   rehashed to scrypt after the first successful sign-in.
 * - Sign-up stays enabled at the Better Auth level (`disableSignUp` would also
 *   block the server-side `auth.api.signUpEmail` call); the self-signup
 *   setting, first-user rule and password policy are enforced in
 *   `hooks.before`.
 * - No admin plugin (no /admin/* HTTP surface, no impersonation). Admin
 *   actions go through src/lib/actions/admin.ts + src/lib/db/users.ts.
 */

export const AUTH_COOKIE_PREFIX = 'sampolio';

const INACTIVE_MESSAGE = 'This account is deactivated. Contact an administrator.';

function resolveBaseURL(): string {
  const configured = process.env.AUTH_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_URL must be set in production (the public https origin; it is also the passkey RP ID).');
  }
  return `http://localhost:${process.env.PORT || 4999}`;
}

function isLegacyBcryptHash(hash: string | null | undefined): hash is string {
  return !!hash && hash.startsWith('$2');
}

function isUserAllowedToSignIn(userId: string): boolean {
  const row = getDb()
    .select({ isActive: schema.user.isActive, deletedAt: schema.user.deletedAt })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .get();
  return !!row && row.isActive && !row.deletedAt;
}

/** Dev-only password-less sign-in as DEV_AUTH_BYPASS (src/app/dev-login).
 * Server-only endpoint: never on the HTTP router. Registered only outside
 * production AND when the flag is set. */
function devBypassPlugin() {
  return {
    id: 'sampolio-dev-bypass',
    endpoints: {
      devBypassSignIn: createAuthEndpoint.serverOnly({ method: 'POST' }, async (ctx) => {
        const email = (process.env.DEV_AUTH_BYPASS ?? '').trim().toLowerCase();
        const found = email ? await ctx.context.internalAdapter.findUserByEmail(email) : null;
        if (!found) {
          console.error(`[auth] DEV_AUTH_BYPASS="${email}" but no such user exists locally. Sign that account up first (or check ENCRYPTION_KEY).`);
          throw new APIError('NOT_FOUND', { message: 'Dev bypass user not found' });
        }
        const created = await ctx.context.internalAdapter.createSession(found.user.id);
        if (!created) throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Failed to create session' });
        await setSessionCookie(ctx, { session: created, user: found.user });
        console.warn(`[auth] ⚠️  DEV AUTH BYPASS active — signed in as ${email} without a password.`);
        return ctx.json({ ok: true });
      }),
    },
  } satisfies BetterAuthPlugin;
}

export function isDevBypassEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && !!process.env.DEV_AUTH_BYPASS;
}

function buildAuthOptions() {
  const baseURL = resolveBaseURL();
  const origin = new URL(baseURL).origin;

  return {
    appName: 'Sampolio',
    baseURL,
    basePath: '/api/auth',
    secret: process.env.AUTH_SECRET,
    telemetry: { enabled: false },
    onAPIError: { errorURL: '/auth/error' },
    database: drizzleAdapter(getDb(), { provider: 'sqlite', schema }),

    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      autoSignIn: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      password: {
        hash: (password: string) => hashPassword(password),
        verify: async ({ hash, password }: { hash: string; password: string }) =>
          isLegacyBcryptHash(hash) ? bcrypt.compare(password, hash) : verifyPassword({ hash, password }),
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      freshAge: 0,
      cookieCache: { enabled: false },
    },

    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'user', input: false },
        isActive: { type: 'boolean', required: false, defaultValue: true, input: false },
        deletedAt: { type: 'date', required: false, input: false },
        avatarVersion: { type: 'number', required: false, input: false },
      },
    },

    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/change-password': { window: 60, max: 5 },
        '/passkey/verify-authentication': { window: 60, max: 10 },
        '/passkey/generate-authenticate-options': { window: 60, max: 30 },
        '/passkey/verify-registration': { window: 60, max: 10 },
      },
    },

    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: baseURL.startsWith('https://'),
      database: { generateId: 'uuid' },
      // Behind Cloudflare Tunnel + Caddy every request comes from loopback;
      // without these the rate limiter would put all clients in one bucket.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
    },

    databaseHooks: {
      user: {
        create: {
          before: async (data) => {
            const isFirstUser = countUsers() === 0;
            return { data: { ...data, role: isFirstUser ? 'admin' : 'user', isActive: true, deletedAt: null } };
          },
          after: async (created) => {
            await ensureDir(getUserDir(created.id));
          },
        },
      },
      session: {
        create: {
          // Covers every sign-in method (password, passkey, dev bypass).
          before: async (data) => {
            if (!isUserAllowedToSignIn(data.userId)) {
              throw new APIError('FORBIDDEN', { code: 'ACCOUNT_INACTIVE', message: INACTIVE_MESSAGE });
            }
            return { data };
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email') {
          const isFirstUser = countUsers() === 0;
          if (!isFirstUser && !(await isSelfSignupEnabled())) {
            throw new APIError('FORBIDDEN', {
              code: 'SIGNUP_DISABLED',
              message: 'Self-signup is currently disabled. Please contact an administrator.',
            });
          }
          const name = signUpNameSchema.safeParse(ctx.body?.name);
          if (!name.success) {
            throw new APIError('BAD_REQUEST', { code: 'INVALID_NAME', message: name.error.issues[0]?.message ?? 'Invalid name' });
          }
          const password = passwordPolicySchema.safeParse(ctx.body?.password);
          if (!password.success) {
            throw new APIError('BAD_REQUEST', { code: 'WEAK_PASSWORD', message: password.error.issues[0]?.message ?? 'Invalid password' });
          }
        }

        if (ctx.path === '/change-password') {
          const password = passwordPolicySchema.safeParse(ctx.body?.newPassword);
          if (!password.success) {
            throw new APIError('BAD_REQUEST', { code: 'WEAK_PASSWORD', message: password.error.issues[0]?.message ?? 'Invalid password' });
          }
        }

        if (ctx.path === '/passkey/generate-register-options') {
          // No session ⇒ fall through to the plugin's own 401.
          const current = await getSessionFromCtx(ctx);
          if (current) {
            const ageMs = Date.now() - new Date(current.session.createdAt).getTime();
            if (ageMs > PASSKEY_REGISTRATION_MAX_SESSION_AGE_MS) {
              throw new APIError('FORBIDDEN', {
                code: PASSKEY_REAUTH_REQUIRED,
                message: 'For security, sign in again to add a passkey.',
              });
            }
          }
        }

        if (ctx.path === '/sign-in/email') {
          const email = String(ctx.body?.email ?? '').trim().toLowerCase();
          if (email && (await isAccountLocked(email))) {
            const retryAfter = Math.max(1, getLockoutRetryAfterSeconds(email));
            console.warn(`[auth] Account locked: ${email}`);
            throw new APIError(
              'TOO_MANY_REQUESTS',
              { code: 'ACCOUNT_LOCKED', message: 'Too many failed sign-in attempts. Please wait before trying again.', retryAfter },
              { 'Retry-After': String(retryAfter) },
            );
          }
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const email = String(ctx.body?.email ?? '').trim().toLowerCase();
        const returned = ctx.context.returned;
        if (isAPIError(returned)) {
          // 401 = unknown email or wrong password (counted, also for unknown
          // emails so lockout does not reveal which accounts exist). 403
          // (inactive) and 429 (locked) are not counted.
          if (returned.statusCode === 401 && email) {
            console.warn(`[auth] Failed sign-in for: ${email}`);
            await recordFailedLogin(email);
          }
          return;
        }
        const newSession = ctx.context.newSession;
        if (!newSession) return;
        await recordSuccessfulLogin(email);

        // Opportunistic bcrypt → scrypt upgrade for imported legacy hashes.
        const password = typeof ctx.body?.password === 'string' ? ctx.body.password : '';
        const accounts = await ctx.context.internalAdapter.findAccounts(newSession.user.id);
        const credential = accounts.find((a) => a.providerId === 'credential');
        if (password && isLegacyBcryptHash(credential?.password)) {
          await ctx.context.internalAdapter.updatePassword(newSession.user.id, await ctx.context.password.hash(password));
          console.log(`[auth] Rehashed legacy bcrypt password to scrypt for user ${newSession.user.id}`);
        }
      }),
    },

    plugins: [
      passkey({
        rpID: new URL(baseURL).hostname,
        rpName: 'Sampolio',
        origin,
        registration: {
          // Default label from the authenticator model (AAGUID); a name the
          // client sends always wins.
          afterVerification: async ({ verification }) => ({
            name: getAuthenticatorName(verification.registrationInfo?.aaguid) ?? DEFAULT_PASSKEY_NAME,
          }),
        },
        authentication: {
          afterVerification: async ({ clientData }) => {
            touchPasskeyByCredentialId(clientData.id);
          },
        },
      }),
      ...(isDevBypassEnabled() ? [devBypassPlugin()] : []),
      nextCookies(), // must stay last
    ],
  } satisfies BetterAuthOptions;
}

function createAuth() {
  return betterAuth(buildAuthOptions());
}

export type SampolioAuth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as typeof globalThis & { __sampolioAuth?: SampolioAuth };

/** The process-wide Better Auth instance. */
export function getAuth(): SampolioAuth {
  if (!globalForAuth.__sampolioAuth) globalForAuth.__sampolioAuth = createAuth();
  return globalForAuth.__sampolioAuth;
}

/** Drop the cached instance (tests that switch DATA_DIR / env). */
export function resetAuthForTests(): void {
  globalForAuth.__sampolioAuth = undefined;
}

/** Server-only dev bypass sign-in (see devBypassPlugin). Returns the
 * Set-Cookie headers so a route handler can attach them to its redirect. */
export async function devBypassSignIn(headers: Headers): Promise<Headers> {
  if (!isDevBypassEnabled()) throw new Error('Dev auth bypass is disabled');
  const api = getAuth().api as unknown as {
    devBypassSignIn: (input: { headers: Headers; returnHeaders: true }) => Promise<{ headers: Headers }>;
  };
  const result = await api.devBypassSignIn({ headers, returnHeaders: true });
  return result.headers;
}
