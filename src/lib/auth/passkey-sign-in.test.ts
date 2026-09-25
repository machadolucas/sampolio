import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTempDataDir } from '@/test/temp-data-dir';
import { SoftAuthenticator } from '@/test/soft-authenticator';
import { getAuth, resetAuthForTests } from './server';
import { bootstrapDatabase } from '@/lib/db/sqlite/bootstrap';
import { closeDb, getDb } from '@/lib/db/sqlite/client';
import { passkey, rateLimit, session } from '@/lib/db/sqlite/schema';
import { recordPasskeySignIn } from '@/lib/db/passkeys';
import { updateUser } from '@/lib/db/users';

/**
 * Passkey sign-in against the real Better Auth instance, driven by a software
 * authenticator so @simplewebauthn/server verifies every assertion for real.
 * Covers where `passkey.lastUsedAt` is stamped: only once a session exists,
 * only on the passkey that signed in, never on a refused sign-in.
 */

const ORIGIN = 'http://localhost:4998'; // AUTH_URL from useTempDataDir
const STRONG = 'Str0ng!pass';

let tmp: ReturnType<typeof useTempDataDir>;
const ids = { alex: '', sam: '' };

beforeAll(async () => {
  tmp = useTempDataDir('sampolio-passkey-signin-test-');
  closeDb();
  resetAuthForTests();
  expect((await bootstrapDatabase()).ok).toBe(true);
  for (const [name, email] of [['Alex', 'alex@example.com'], ['Sam', 'sam@example.com']] as const) {
    const { user: created } = await getAuth().api.signUpEmail({ body: { name, email, password: STRONG } });
    ids[name.toLowerCase() as 'alex' | 'sam'] = created.id;
  }
});

afterAll(() => {
  closeDb();
  resetAuthForTests();
  tmp.cleanup();
});

beforeEach(async () => {
  // Better Auth's HTTP limits (10 verify-authentication/min per IP) would
  // otherwise trip across tests; they are not what this file tests.
  getDb().delete(rateLimit).run();
  await updateUser(ids.alex, { isActive: true });
  await updateUser(ids.sam, { isActive: true });
});

function cookiesFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

async function passwordCookie(email: string): Promise<string> {
  const { headers } = await getAuth().api.signInEmail({ body: { email, password: STRONG }, returnHeaders: true });
  return cookiesFrom(headers);
}

function newKey(): SoftAuthenticator {
  return new SoftAuthenticator({ rpId: 'localhost', origin: ORIGIN });
}

async function register(email: string, key: SoftAuthenticator): Promise<void> {
  const sessionCookie = await passwordCookie(email);
  const auth = getAuth();
  const options = await auth.handler(
    new Request(`${ORIGIN}/api/auth/passkey/generate-register-options`, { headers: { cookie: sessionCookie } }),
  );
  expect(options.status).toBe(200);
  const { challenge } = (await options.json()) as { challenge: string };
  const verify = await auth.handler(
    new Request(`${ORIGIN}/api/auth/passkey/verify-registration`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: [sessionCookie, cookiesFrom(options.headers)].join('; '),
        origin: ORIGIN,
      },
      body: JSON.stringify({ response: key.register(challenge) }),
    }),
  );
  expect(verify.status, await verify.clone().text()).toBe(200);
}

/** generate-authenticate-options → verify-authentication, as the sign-in page does. */
async function signInWithPasskey(key: SoftAuthenticator): Promise<Response> {
  const auth = getAuth();
  const options = await auth.handler(new Request(`${ORIGIN}/api/auth/passkey/generate-authenticate-options`));
  expect(options.status).toBe(200);
  const { challenge } = (await options.json()) as { challenge: string };
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/passkey/verify-authentication`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookiesFrom(options.headers), origin: ORIGIN },
      body: JSON.stringify({ response: key.assert(challenge) }),
    }),
  );
}

function lastUsedOf(key: SoftAuthenticator): Date | null {
  const row = getDb().select().from(passkey).where(eq(passkey.credentialID, key.credentialIdB64)).get();
  expect(row).toBeDefined();
  return row!.lastUsedAt;
}

function sessionCount(userId: string): number {
  return getDb().select().from(session).where(eq(session.userId, userId)).all().length;
}

describe('passkey sign-in lastUsedAt', () => {
  it('stamps only the passkey that signed in, once the session exists', async () => {
    const phone = newKey();
    const laptop = newKey();
    const samsKey = newKey();
    await register('alex@example.com', phone);
    await register('alex@example.com', laptop);
    await register('sam@example.com', samsKey);
    expect([lastUsedOf(phone), lastUsedOf(laptop), lastUsedOf(samsKey)]).toEqual([null, null, null]);

    const before = Date.now();
    const sessionsBefore = sessionCount(ids.alex);
    const response = await signInWithPasskey(laptop);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some((c) => c.includes('session_token'))).toBe(true);
    expect(sessionCount(ids.alex)).toBe(sessionsBefore + 1);

    expect(lastUsedOf(laptop)!.getTime()).toBeGreaterThanOrEqual(before);
    expect(lastUsedOf(phone)).toBeNull();
    expect(lastUsedOf(samsKey)).toBeNull();
  });

  it('stamps nothing when the sign-in is refused (deactivated user)', async () => {
    const key = newKey();
    await register('sam@example.com', key);
    await updateUser(ids.sam, { isActive: false }); // also revokes Sam's sessions

    const response = await signInWithPasskey(key);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe('ACCOUNT_INACTIVE');
    expect(sessionCount(ids.sam)).toBe(0);
    expect(lastUsedOf(key)).toBeNull();

    // Reactivated, the same passkey signs in and is stamped.
    await updateUser(ids.sam, { isActive: true });
    expect((await signInWithPasskey(key)).status).toBe(200);
    expect(lastUsedOf(key)).not.toBeNull();
  });

  it('stamps nothing for a failed assertion', async () => {
    const key = newKey();
    await register('alex@example.com', key);
    const impostor = new SoftAuthenticator({ rpId: 'localhost', origin: ORIGIN });
    // Same credential id, different private key: the signature does not verify.
    Object.defineProperty(impostor, 'credentialId', { value: key.credentialId });

    const response = await signInWithPasskey(impostor);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(lastUsedOf(key)).toBeNull();
  });

  it('scopes the stamp to the signed-in user as well as the credential id', async () => {
    // credentialID is indexed, not unique.
    const key = newKey();
    await register('alex@example.com', key);
    const alexRow = getDb().select().from(passkey).where(eq(passkey.credentialID, key.credentialIdB64)).get()!;
    getDb()
      .insert(passkey)
      .values({ ...alexRow, id: crypto.randomUUID(), userId: ids.sam, lastUsedAt: null })
      .run();

    expect(recordPasskeySignIn({ userId: ids.alex, credentialId: key.credentialIdB64 })).toBe(1);
    const rows = getDb().select().from(passkey).where(eq(passkey.credentialID, key.credentialIdB64)).all();
    expect(Object.fromEntries(rows.map((r) => [r.userId, r.lastUsedAt !== null]))).toEqual({
      [ids.alex]: true,
      [ids.sam]: false,
    });
  });
});
