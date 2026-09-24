import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTempDataDir, UUID_RE } from '@/test/temp-data-dir';

// auth() reads the request headers; tests supply them per case.
const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock('next/headers', () => ({
  headers: async () => requestHeaders.current,
  cookies: async () => {
    throw new Error('`cookies` was called outside a request scope.');
  },
}));

import { makeSignature } from 'better-auth/crypto';
import { getAuth, PASSKEY_REAUTH_REQUIRED, PASSKEY_REGISTRATION_MAX_SESSION_AGE_MS, resetAuthForTests } from './server';
import { auth } from '@/lib/auth';
import { closeDb, getDb } from '@/lib/db/sqlite/client';
import { account, passkey, session, user } from '@/lib/db/sqlite/schema';
import { changePassword, createUser, deleteUser, findUserByEmail, hardDeleteUser, updateUser } from '@/lib/db/users';
import { updateAppSettings } from '@/lib/db/app-settings';
import { bootstrapDatabase } from '@/lib/db/sqlite/bootstrap';

let tmp: ReturnType<typeof useTempDataDir>;

beforeAll(async () => {
  tmp = useTempDataDir('sampolio-auth-test-');
  closeDb();
  resetAuthForTests();
  // As at boot (src/instrumentation.ts): open + migrate + import marker.
  expect((await bootstrapDatabase()).ok).toBe(true);
});

afterAll(() => {
  closeDb();
  resetAuthForTests();
  tmp.cleanup();
});

beforeEach(() => {
  requestHeaders.current = new Headers();
});

const STRONG = 'Str0ng!pass';

async function expectApiError(promise: Promise<unknown>, status: number, code?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as { statusCode?: number; body?: { code?: string; retryAfter?: number } },
  );
  expect(error, 'expected the call to reject').not.toBeNull();
  expect(error?.statusCode).toBe(status);
  if (code) expect(error?.body?.code).toBe(code);
  return error!;
}

/** Sign in and return a Cookie header value for the new session. */
async function signInCookie(email: string, password: string): Promise<string> {
  const { headers } = await getAuth().api.signInEmail({ body: { email, password }, returnHeaders: true });
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function credentialHash(userId: string): string | null | undefined {
  return getDb()
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .get()?.password;
}

describe('sign-up gating and first-user admin', () => {
  it('makes the first user an admin with UUID ids', async () => {
    const result = await getAuth().api.signUpEmail({ body: { name: 'Alex', email: 'alex@example.com', password: STRONG } });
    const created = getDb().select().from(user).where(eq(user.id, result.user.id)).get()!;
    expect(created.id).toMatch(UUID_RE);
    expect(created.role).toBe('admin');
    expect(created.isActive).toBe(true);
    const sessions = getDb().select().from(session).where(eq(session.userId, created.id)).all();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toMatch(UUID_RE);
    const accounts = getDb().select().from(account).where(eq(account.userId, created.id)).all();
    expect(accounts[0]).toMatchObject({ providerId: 'credential', accountId: created.id });
    expect(accounts[0].id).toMatch(UUID_RE);
    // New hashes are scrypt, never bcrypt.
    expect(accounts[0].password?.startsWith('$2')).toBe(false);
  });

  it('rejects weak passwords and too-short names server-side', async () => {
    await expectApiError(
      getAuth().api.signUpEmail({ body: { name: 'Sam', email: 'sam@example.com', password: 'weakpassword' } }),
      400,
      'WEAK_PASSWORD',
    );
    await expectApiError(
      getAuth().api.signUpEmail({ body: { name: 'S', email: 'sam@example.com', password: STRONG } }),
      400,
      'INVALID_NAME',
    );
  });

  it('blocks sign-up when self-signup is disabled, allows it when enabled', async () => {
    await updateAppSettings({ selfSignupEnabled: false }, 'test');
    await expectApiError(
      getAuth().api.signUpEmail({ body: { name: 'Sam', email: 'sam@example.com', password: STRONG } }),
      403,
      'SIGNUP_DISABLED',
    );
    expect(await findUserByEmail('sam@example.com')).toBeNull();

    await updateAppSettings({ selfSignupEnabled: true }, 'test');
    const result = await getAuth().api.signUpEmail({ body: { name: 'Sam', email: 'sam@example.com', password: STRONG } });
    expect((await findUserByEmail('sam@example.com'))?.id).toBe(result.user.id);
    expect((await findUserByEmail('sam@example.com'))?.role).toBe('user');
  });

  it('cannot set role/isActive through the sign-up body', async () => {
    const result = await getAuth().api.signUpEmail({
      body: { name: 'Mallory', email: 'mallory@example.com', password: STRONG, role: 'admin', isActive: true } as never,
    });
    expect((await findUserByEmail('mallory@example.com'))?.role).toBe('user');
    await hardDeleteUser(result.user.id);
  });
});

describe('legacy bcrypt passwords', () => {
  it('signs in with a bcrypt hash and rehashes it to scrypt', async () => {
    const legacy = await createUser('legacy@example.com', 'placeholder', 'Legacy');
    const bcryptHash = await bcrypt.hash('Legacy-Pass-1!', 4);
    getDb().update(account).set({ password: bcryptHash }).where(eq(account.userId, legacy.id)).run();

    await expectApiError(getAuth().api.signInEmail({ body: { email: 'legacy@example.com', password: 'wrong' } }), 401);
    expect(credentialHash(legacy.id)).toBe(bcryptHash);

    const res = await getAuth().api.signInEmail({ body: { email: 'legacy@example.com', password: 'Legacy-Pass-1!' } });
    expect(res.user.id).toBe(legacy.id);
    const upgraded = credentialHash(legacy.id)!;
    expect(upgraded.startsWith('$2')).toBe(false);
    expect(upgraded).toContain(':'); // Better Auth scrypt "salt:key"

    // Still works after the upgrade.
    const again = await getAuth().api.signInEmail({ body: { email: 'LEGACY@example.com', password: 'Legacy-Pass-1!' } });
    expect(again.user.id).toBe(legacy.id);
  });
});

describe('deactivation and deletion', () => {
  it('auth() returns the old session shape and drops a deactivated user immediately', async () => {
    const cookie = await signInCookie('sam@example.com', STRONG);
    requestHeaders.current = new Headers({ cookie });
    const sam = (await findUserByEmail('sam@example.com'))!;

    expect(await auth()).toEqual({ user: { id: sam.id, email: 'sam@example.com', name: 'Sam', role: 'user' } });

    // Flip the flag WITHOUT revoking sessions: auth() re-checks on every call.
    getDb().update(user).set({ isActive: false }).where(eq(user.id, sam.id)).run();
    expect(await auth()).toBeNull();
    getDb().update(user).set({ isActive: true }).where(eq(user.id, sam.id)).run();
    expect((await auth())?.user.id).toBe(sam.id);

    // The admin path also revokes every session.
    await updateUser(sam.id, { isActive: false });
    expect(getDb().select().from(session).where(eq(session.userId, sam.id)).all()).toHaveLength(0);
    expect(await auth()).toBeNull();
  });

  it('blocks sign-in for a deactivated user (any method: session.create hook)', async () => {
    await expectApiError(
      getAuth().api.signInEmail({ body: { email: 'sam@example.com', password: STRONG } }),
      403,
      'ACCOUNT_INACTIVE',
    );
    const sam = (await findUserByEmail('sam@example.com'))!;
    const ctx = await getAuth().$context;
    await expect(ctx.internalAdapter.createSession(sam.id)).rejects.toMatchObject({ statusCode: 403 });

    await updateUser(sam.id, { isActive: true });
    const res = await getAuth().api.signInEmail({ body: { email: 'sam@example.com', password: STRONG } });
    expect(res.user.id).toBe(sam.id);
  });

  it('soft delete blocks sign-in, frees the email and keeps the row', async () => {
    const temp = await createUser('temp@example.com', STRONG, 'Temp');
    expect(await deleteUser(temp.id)).toBe(true);
    expect(await findUserByEmail('temp@example.com')).toBeNull();
    const row = getDb().select().from(user).where(eq(user.id, temp.id)).get()!;
    expect(row.deletedAt).not.toBeNull();
    expect(row.isActive).toBe(false);
    await expectApiError(getAuth().api.signInEmail({ body: { email: 'temp@example.com', password: STRONG } }), 401);
    const ctx = await getAuth().$context;
    await expect(ctx.internalAdapter.createSession(temp.id)).rejects.toMatchObject({ statusCode: 403 });

    const reused = await createUser('temp@example.com', STRONG, 'Temp 2');
    expect(reused.id).not.toBe(temp.id);
  });

  it('admin password reset keeps passkeys, revokes sessions; hard delete cascades', async () => {
    const pk = await createUser('pk@example.com', STRONG, 'Passkey User');
    await signInCookie('pk@example.com', STRONG);
    getDb()
      .insert(passkey)
      .values({ id: crypto.randomUUID(), userId: pk.id, publicKey: 'x', credentialID: 'cred-1', counter: 0, deviceType: 'multiDevice', backedUp: true })
      .run();

    expect(await changePassword(pk.id, 'N3w!password')).toBe(true);
    expect(getDb().select().from(session).where(eq(session.userId, pk.id)).all()).toHaveLength(0);
    expect(getDb().select().from(passkey).where(eq(passkey.userId, pk.id)).all()).toHaveLength(1);
    const res = await getAuth().api.signInEmail({ body: { email: 'pk@example.com', password: 'N3w!password' } });
    expect(res.user.id).toBe(pk.id);

    await hardDeleteUser(pk.id);
    expect(getDb().select().from(user).where(eq(user.id, pk.id)).all()).toHaveLength(0);
    expect(getDb().select().from(session).where(eq(session.userId, pk.id)).all()).toHaveLength(0);
    expect(getDb().select().from(account).where(eq(account.userId, pk.id)).all()).toHaveLength(0);
    expect(getDb().select().from(passkey).where(eq(passkey.userId, pk.id)).all()).toHaveLength(0);
  });
});

describe('brute-force lockout', () => {
  it('returns 429 with retryAfter after 10 failed attempts, even for the right password', async () => {
    await createUser('lock@example.com', STRONG, 'Lock');
    for (let i = 0; i < 10; i += 1) {
      await expectApiError(getAuth().api.signInEmail({ body: { email: 'lock@example.com', password: `wrong-${i}` } }), 401);
    }
    const locked = await expectApiError(
      getAuth().api.signInEmail({ body: { email: 'lock@example.com', password: STRONG } }),
      429,
      'ACCOUNT_LOCKED',
    );
    expect(locked.body?.retryAfter).toBeGreaterThan(0);
    expect(locked.body?.retryAfter).toBeLessThanOrEqual(15 * 60);

    // Other accounts are unaffected.
    const ok = await getAuth().api.signInEmail({ body: { email: 'alex@example.com', password: STRONG } });
    expect(ok.user.email).toBe('alex@example.com');
  });
});

describe('passkey registration re-auth guard', () => {
  const MINUTE = 60 * 1000;

  async function registerOptions(cookie: string) {
    return getAuth().api.generatePasskeyRegistrationOptions({ headers: new Headers({ cookie }) });
  }

  function tokenOf(cookie: string): string {
    const value = decodeURIComponent(cookie.split('sampolio.session_token=')[1].split(';')[0]);
    return value.slice(0, value.lastIndexOf('.'));
  }

  function ageSession(token: string, ageMs: number, extra: Partial<typeof session.$inferInsert> = {}) {
    getDb()
      .update(session)
      .set({ createdAt: new Date(Date.now() - ageMs), ...extra })
      .where(eq(session.token, token))
      .run();
  }

  it('uses a 10-minute window', () => {
    expect(PASSKEY_REGISTRATION_MAX_SESSION_AGE_MS).toBe(10 * MINUTE);
  });

  it('allows a fresh password session', async () => {
    const cookie = await signInCookie('alex@example.com', STRONG);
    const options = await registerOptions(cookie);
    expect(options.challenge).toEqual(expect.any(String));
    expect(options.rp).toMatchObject({ id: 'localhost', name: 'Sampolio' });
  });

  it('allows a fresh passkey-created session (internalAdapter.createSession, as the plugin does)', async () => {
    const ctx = await getAuth().$context;
    const alex = (await findUserByEmail('alex@example.com'))!;
    const created = (await ctx.internalAdapter.createSession(alex.id))!;
    const signed = `${created.token}.${await makeSignature(created.token, ctx.secret)}`;
    const options = await registerOptions(`sampolio.session_token=${encodeURIComponent(signed)}`);
    expect(options.challenge).toEqual(expect.any(String));
  });

  it('still allows a 9-minute-old session', async () => {
    const cookie = await signInCookie('alex@example.com', STRONG);
    ageSession(tokenOf(cookie), 9 * MINUTE);
    await expect(registerOptions(cookie)).resolves.toMatchObject({ challenge: expect.any(String) });
  });

  it('refuses an older session with PASSKEY_REAUTH_REQUIRED', async () => {
    const cookie = await signInCookie('alex@example.com', STRONG);
    ageSession(tokenOf(cookie), 11 * MINUTE);
    await expectApiError(registerOptions(cookie), 403, PASSKEY_REAUTH_REQUIRED);

    // Same when the session is also due for its daily refresh (the guard's
    // session lookup may emit a Set-Cookie).
    ageSession(tokenOf(cookie), 2 * 24 * 60 * MINUTE, { expiresAt: new Date(Date.now() + 28 * 24 * 60 * MINUTE) });
    await expectApiError(registerOptions(cookie), 403, PASSKEY_REAUTH_REQUIRED);
  });

  it('leaves a missing session to the plugin (401)', async () => {
    await expectApiError(getAuth().api.generatePasskeyRegistrationOptions({ headers: new Headers() }), 401);
  });
});
