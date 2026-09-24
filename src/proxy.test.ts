import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { useTempDataDir } from '@/test/temp-data-dir';

// Real Better Auth + temp SQLCipher DB; only getProxySession is wrapped so a
// test can make the lookup itself fail.
vi.mock('@/lib/auth/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/server')>();
  return { ...actual, getProxySession: vi.fn(actual.getProxySession) };
});

import { getAuth, getProxySession, resetAuthForTests } from '@/lib/auth/server';
import { toAppSession } from '@/lib/auth/session';
import { bootstrapDatabase } from '@/lib/db/sqlite/bootstrap';
import { closeDb, getDb } from '@/lib/db/sqlite/client';
import { session, user } from '@/lib/db/sqlite/schema';
import { clearSetupFailure, markSetupFailed } from '@/lib/db/sqlite/setup-state';
import { proxy } from './proxy';

const ORIGIN = 'http://localhost:4998';
const STRONG = 'Str0ng!pass';
const COOKIE = 'sampolio.session_token'; // http ⇒ no __Secure- prefix

let tmp: ReturnType<typeof useTempDataDir>;
let alexId = '';

beforeAll(async () => {
  tmp = useTempDataDir('sampolio-proxy-test-');
  closeDb();
  resetAuthForTests();
  expect((await bootstrapDatabase()).ok).toBe(true);
  const created = await getAuth().api.signUpEmail({ body: { name: 'Alex', email: 'alex@example.com', password: STRONG } });
  alexId = created.user.id;
});

afterAll(() => {
  closeDb();
  resetAuthForTests();
  tmp.cleanup();
});

beforeEach(() => {
  vi.mocked(getProxySession).mockClear();
  clearSetupFailure();
  getDb().update(user).set({ isActive: true }).where(eq(user.id, alexId)).run();
});

async function signInCookie(): Promise<string> {
  const { headers } = await getAuth().api.signInEmail({
    body: { email: 'alex@example.com', password: STRONG },
    returnHeaders: true,
  });
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function request(path: string, cookie?: string, method = 'GET'): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, { method, headers: cookie ? { cookie } : {} });
}

function isPassThrough(response: Response): boolean {
  return response.headers.get('x-middleware-next') === '1';
}

/** Names of cookies the response expires (Max-Age=0). */
function expiredCookies(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .filter((c) => /max-age=0/i.test(c))
    .map((c) => c.split('=')[0]);
}

describe('auth pages with a valid session', () => {
  it('redirects /auth/signin to Home and keeps the cookie', async () => {
    const cookie = await signInCookie();
    const response = await proxy(request('/auth/signin', cookie));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/');
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('honours a same-origin callbackUrl, also on /auth/signup', async () => {
    const cookie = await signInCookie();
    const signin = await proxy(request('/auth/signin?callbackUrl=%2Fsettings%3Ftab%3Daccount', cookie));
    const location = new URL(signin.headers.get('location')!);
    expect(`${location.pathname}${location.search}`).toBe('/settings?tab=account');
    const signup = await proxy(request('/auth/signup?callbackUrl=/overview', cookie));
    expect(new URL(signup.headers.get('location')!).pathname).toBe('/overview');
  });

  it.each(['//evil.example.com/x', 'https://evil.example.com/', '/auth/signin', '/auth/signup?x=1'])(
    'never redirects to %s',
    async (callbackUrl) => {
      const cookie = await signInCookie();
      const response = await proxy(request(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, cookie));
      const location = new URL(response.headers.get('location')!);
      expect(location.origin).toBe(ORIGIN);
      expect(location.pathname).toBe('/');
    },
  );

  it('does not redirect a POST (server actions on the auth pages)', async () => {
    const cookie = await signInCookie();
    const response = await proxy(request('/auth/signup', cookie, 'POST'));
    expect(isPassThrough(response)).toBe(true);
    expect(expiredCookies(response)).toEqual([]);
  });

  it('does not extend the session (read-only lookup)', async () => {
    const cookie = await signInCookie();
    const token = decodeURIComponent(cookie.split(`${COOKIE}=`)[1]).split('.')[0];
    const due = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // past updateAge
    getDb().update(session).set({ expiresAt: due }).where(eq(session.token, token)).run();
    await proxy(request('/auth/signin', cookie));
    const row = getDb().select().from(session).where(eq(session.token, token)).get()!;
    expect(row.expiresAt.getTime()).toBe(due.getTime());
  });
});

describe('auth pages with a stale cookie', () => {
  it('clears a revoked session cookie and renders the page', async () => {
    const cookie = await signInCookie();
    getDb().delete(session).where(eq(session.userId, alexId)).run();
    const response = await proxy(request('/auth/signin', cookie));
    expect(isPassThrough(response)).toBe(true);
    expect(expiredCookies(response)).toEqual([COOKIE]);
  });

  it('clears a forged/garbled cookie', async () => {
    const response = await proxy(request('/auth/signin', `${COOKIE}=not-a-real-token.bad-signature`));
    expect(isPassThrough(response)).toBe(true);
    expect(expiredCookies(response)).toEqual([COOKIE]);
  });

  it('clears the cookie of a deactivated user', async () => {
    const cookie = await signInCookie();
    getDb().update(user).set({ isActive: false }).where(eq(user.id, alexId)).run();
    const response = await proxy(request('/auth/signup', cookie));
    expect(expiredCookies(response)).toEqual([COOKIE]);
  });

  it('clears the cookie while auth setup has failed (auth() rejects it too)', async () => {
    const cookie = await signInCookie();
    markSetupFailed(new Error('test'), { dbDiscarded: false });
    const response = await proxy(request('/auth/signin', cookie));
    expect(isPassThrough(response)).toBe(true);
    expect(expiredCookies(response)).toEqual([COOKIE]);
  });

  it('sweeps pre-4.0 Auth.js cookies even without a Better Auth cookie', async () => {
    const response = await proxy(request('/auth/signin', 'authjs.session-token=old; next-auth.session-token=older'));
    expect(isPassThrough(response)).toBe(true);
    expect(expiredCookies(response).sort()).toEqual(['authjs.session-token', 'next-auth.session-token']);
    expect(getProxySession).not.toHaveBeenCalled();
  });

  it('renders without touching cookies when the lookup itself fails', async () => {
    const cookie = await signInCookie();
    vi.mocked(getProxySession).mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await proxy(request('/auth/signin', cookie));
    expect(isPassThrough(response)).toBe(true);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('auth pages without a cookie', () => {
  it('renders the page with no lookup and no Set-Cookie', async () => {
    for (const path of ['/auth/signin', '/auth/signup', '/auth/signin?callbackUrl=/overview']) {
      const response = await proxy(request(path));
      expect(isPassThrough(response)).toBe(true);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(getProxySession).not.toHaveBeenCalled();
  });
});

/**
 * Tiny browser: a cookie jar that follows redirects through the proxy, and
 * for app pages the proxy passes through, emulates the (dashboard) layout —
 * auth() null ⇒ redirect('/auth/signin'). Returns the pages visited.
 */
async function browse(start: string, jar: Map<string, string>, maxHops = 6): Promise<string[]> {
  const visited: string[] = [];
  let path = start;
  for (let hop = 0; hop < maxHops; hop++) {
    visited.push(path);
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const response = await proxy(request(path, cookie || undefined));
    for (const set of response.headers.getSetCookie()) {
      const [pair] = set.split(';');
      const [name, ...rest] = pair.split('=');
      if (/max-age=0/i.test(set)) jar.delete(name);
      else jar.set(name, rest.join('='));
    }
    const location = response.headers.get('location');
    if (location) {
      const next = new URL(location, ORIGIN);
      path = `${next.pathname}${next.search}`;
      continue;
    }
    if (path.startsWith('/auth/')) return visited; // auth page rendered
    const headers = new Headers(cookie ? { cookie } : {});
    const appSession = toAppSession(await getAuth().api.getSession({ headers }));
    if (appSession) return visited; // app page rendered
    path = '/auth/signin';
  }
  throw new Error(`redirect loop: ${visited.join(' → ')}`);
}

describe('no redirect loop', () => {
  it('stale cookie on a protected page ends on a rendered sign-in page with the cookie gone', async () => {
    const cookie = await signInCookie();
    getDb().delete(session).where(eq(session.userId, alexId)).run();
    const jar = new Map([[COOKIE, cookie.split(`${COOKIE}=`)[1]]]);
    const visited = await browse('/overview', jar);
    expect(visited).toEqual(['/overview', '/auth/signin']);
    expect(jar.has(COOKIE)).toBe(false);
    // …and the next visit is the ordinary unauthenticated flow.
    expect(await browse('/overview', jar)).toEqual(['/overview', '/auth/signin?callbackUrl=%2Foverview']);
  });

  it('valid session on the sign-in page ends on the app page with the cookie kept', async () => {
    const cookie = await signInCookie();
    const jar = new Map([[COOKIE, cookie.split(`${COOKIE}=`)[1]]]);
    expect(await browse('/auth/signin?callbackUrl=/overview', jar)).toEqual([
      '/auth/signin?callbackUrl=/overview',
      '/overview',
    ]);
    expect(jar.has(COOKIE)).toBe(true);
  });

  it('deactivated user: protected page → sign-in, once', async () => {
    const cookie = await signInCookie();
    getDb().update(user).set({ isActive: false }).where(eq(user.id, alexId)).run();
    const jar = new Map([[COOKIE, cookie.split(`${COOKIE}=`)[1]]]);
    expect(await browse('/', jar)).toEqual(['/', '/auth/signin']);
    expect(jar.has(COOKIE)).toBe(false);
  });
});
