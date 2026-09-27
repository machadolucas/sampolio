import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Real Better Auth + real auth() on a temp encrypted DB; only Next's request
// APIs are stubbed (no request scope under vitest).
const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock('next/headers', () => ({
  headers: async () => requestHeaders.current,
  cookies: async () => {
    throw new Error('`cookies` was called outside a request scope.');
  },
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

import { useTempDataDir } from '@/test/temp-data-dir';
import { closeDb } from '@/lib/db/sqlite/client';
import { bootstrapDatabase } from '@/lib/db/sqlite/bootstrap';
import { getAuth, resetAuthForTests } from '@/lib/auth/server';
import { resetRateLimits } from '@/lib/rate-limit';
import { updateAppSettings } from '@/lib/db/app-settings';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/sqlite/client';
import { session as sessionTable } from '@/lib/db/sqlite/schema';
import { findUserByEmail } from '@/lib/db/users';
import { RECENT_SIGN_IN_REQUIRED_MESSAGE } from '@/lib/auth/constants';
import { changeMyPassword, deleteMyAccount, resetMyData } from './account';
import { signUp } from './auth';

const STRONG = 'Str0ng!pass';
let tmp: ReturnType<typeof useTempDataDir>;

beforeAll(async () => {
  tmp = useTempDataDir('sampolio-auth-actions-');
  closeDb();
  resetAuthForTests();
  expect((await bootstrapDatabase()).ok).toBe(true);
  // Missing app-settings fail closed once a user exists; these tests sign up many.
  await updateAppSettings({ selfSignupEnabled: true }, 'test');
});
afterAll(() => {
  closeDb();
  resetAuthForTests();
  tmp.cleanup();
});
beforeEach(() => {
  resetRateLimits();
  requestHeaders.current = new Headers({ 'x-forwarded-for': '203.0.113.7' });
});

async function cookieFor(email: string, password: string): Promise<string> {
  const { headers } = await getAuth().api.signInEmail({ body: { email, password }, returnHeaders: true });
  return headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

describe('signUp action rate limit', () => {
  it('allows 5 sign-ups per IP per window, then refuses; another IP still works', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await signUp({ name: `User ${i}`, email: `user${i}@example.com`, password: STRONG });
      expect(res.success, res.error).toBe(true);
    }
    const limited = await signUp({ name: 'User 5', email: 'user5@example.com', password: STRONG });
    expect(limited).toMatchObject({ success: false, error: expect.stringMatching(/Too many sign-up attempts/) });

    requestHeaders.current = new Headers({ 'cf-connecting-ip': '198.51.100.9' });
    expect((await signUp({ name: 'User 5', email: 'user5@example.com', password: STRONG })).success).toBe(true);
  });

  it('has a global ceiling across IPs', async () => {
    let refused = 0;
    for (let i = 0; i < 35; i += 1) {
      requestHeaders.current = new Headers({ 'x-forwarded-for': `192.0.2.${i}` });
      // Invalid-but-parseable duplicates still count toward the limit.
      const res = await signUp({ name: 'Dup User', email: 'user0@example.com', password: STRONG });
      if (res.error?.startsWith('Too many sign-up attempts')) refused += 1;
    }
    expect(refused).toBe(5);
  });
});

describe('changeMyPassword lockout', () => {
  it('locks after 10 wrong current passwords (429-style message), even for the right one', async () => {
    const cookie = await cookieFor('user0@example.com', STRONG);
    requestHeaders.current = new Headers({ cookie, origin: 'http://localhost:4998' });
    const input = (current: string) => ({ currentPassword: current, newPassword: 'N3w!password', confirmPassword: 'N3w!password' });

    for (let i = 0; i < 9; i += 1) {
      expect(await changeMyPassword(input(`wrong-${i}`))).toEqual({ success: false, error: 'Current password is incorrect' });
    }
    const tenth = await changeMyPassword(input('wrong-9'));
    expect(tenth.error).toMatch(/Too many incorrect passwords\. Try again in \d+ min\./);
    const correct = await changeMyPassword(input(STRONG));
    expect(correct.error).toMatch(/Too many incorrect passwords/);
    // Password unchanged.
    await expect(cookieFor('user0@example.com', STRONG)).resolves.toContain('sampolio.session_token=');
  });

  it('succeeds and resets the counter for another user', async () => {
    const cookie = await cookieFor('user1@example.com', STRONG);
    requestHeaders.current = new Headers({ cookie, origin: 'http://localhost:4998' });
    expect((await changeMyPassword({ currentPassword: 'nope', newPassword: 'N3w!password', confirmPassword: 'N3w!password' })).success).toBe(false);
    expect(await changeMyPassword({ currentPassword: STRONG, newPassword: 'N3w!password', confirmPassword: 'N3w!password' })).toEqual({ success: true });
    await expect(cookieFor('user1@example.com', 'N3w!password')).resolves.toContain('sampolio.session_token=');
  });
});

describe('HTTP surface', () => {
  it('disables /update-user', async () => {
    const cookie = await cookieFor('user2@example.com', STRONG);
    const res = await getAuth().handler(
      new Request('http://localhost:4998/api/auth/update-user', {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost:4998', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      }),
    );
    expect(res.status).toBe(404);

    // Control: the same cookie works on an enabled endpoint.
    const ok = await getAuth().handler(new Request('http://localhost:4998/api/auth/get-session', { headers: { cookie } }));
    expect(ok.status).toBe(200);
    expect((await ok.json())?.user?.email).toBe('user2@example.com');
  });

  it('disables /change-password (the action with the per-user lockout is the only path)', async () => {
    const cookie = await cookieFor('user2@example.com', STRONG);
    const res = await getAuth().handler(
      new Request('http://localhost:4998/api/auth/change-password', {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost:4998', 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: STRONG, newPassword: 'N3w!password', revokeOtherSessions: false }),
      }),
    );
    expect(res.status).toBe(404);
    // Password unchanged.
    await expect(cookieFor('user2@example.com', STRONG)).resolves.toContain('sampolio.session_token=');
  });
});

describe('destructive self-service needs a recent sign-in', () => {
  async function signedIn(email: string, ageMinutes: number) {
    const cookie = await cookieFor(email, STRONG);
    const user = await findUserByEmail(email);
    const createdAt = new Date(Date.now() - ageMinutes * 60 * 1000);
    getDb().update(sessionTable).set({ createdAt }).where(eq(sessionTable.userId, user!.id)).run();
    requestHeaders.current = new Headers({ cookie, origin: 'http://localhost:4998' });
    return user!;
  }

  it('refuses resetMyData and deleteMyAccount on a session older than 10 minutes', async () => {
    const user = await signedIn('user3@example.com', 11);
    expect(await resetMyData()).toEqual({ success: false, error: RECENT_SIGN_IN_REQUIRED_MESSAGE });
    expect(await deleteMyAccount({ confirmationText: 'user3@example.com' })).toEqual({
      success: false,
      error: RECENT_SIGN_IN_REQUIRED_MESSAGE,
    });
    expect((await findUserByEmail('user3@example.com'))?.id).toBe(user.id);
  });

  it('allows them right after signing in', async () => {
    await signedIn('user3@example.com', 1);
    expect(await resetMyData()).toEqual({ success: true });
  });
});
