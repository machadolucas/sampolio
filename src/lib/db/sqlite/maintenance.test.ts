import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTempDataDir } from '@/test/temp-data-dir';
import { getAuth, resetAuthForTests } from '@/lib/auth/server';
import { bootstrapDatabase } from './bootstrap';
import { closeDb, getDb } from './client';
import {
  pruneExpiredVerifications,
  pruneStaleRateLimits,
  runRateLimitPruneLogged,
  runVerificationPruneLogged,
  startMaintenanceScheduler,
  stopMaintenanceScheduler,
} from './maintenance';
import { rateLimit, verification } from './schema';
import { AUTH_RATE_LIMIT, rateLimitRowRetentionMs } from '@/lib/auth/rate-limit-rules';

let tmp: ReturnType<typeof useTempDataDir>;

beforeAll(async () => {
  tmp = useTempDataDir('sampolio-maintenance-test-');
  closeDb();
  resetAuthForTests();
  expect((await bootstrapDatabase()).ok).toBe(true);
});

afterAll(() => {
  stopMaintenanceScheduler();
  closeDb();
  resetAuthForTests();
  tmp.cleanup();
});

beforeEach(() => {
  getDb().delete(verification).run();
  getDb().delete(rateLimit).run();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  stopMaintenanceScheduler();
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function insertVerification(identifier: string, expiresAt: Date) {
  getDb()
    .insert(verification)
    .values({ id: crypto.randomUUID(), identifier, value: '{}', expiresAt })
    .run();
}

function insertRateLimit(key: string, lastRequest: number, count = 1) {
  getDb().insert(rateLimit).values({ id: crypto.randomUUID(), key, count, lastRequest }).run();
}

function rateLimitKeys(): string[] {
  return getDb()
    .select({ key: rateLimit.key })
    .from(rateLimit)
    .all()
    .map((r) => r.key)
    .sort();
}

function identifiers(): string[] {
  return getDb()
    .select({ identifier: verification.identifier })
    .from(verification)
    .all()
    .map((r) => r.identifier)
    .sort();
}

async function loadSignInChallenge(): Promise<Response> {
  // What the sign-in page's conditional UI does on every load.
  return getAuth().handler(new Request('http://localhost:4998/api/auth/passkey/generate-authenticate-options'));
}

describe('expired verification pruning', () => {
  it('each passkey options request leaves a 5-minute challenge row behind', async () => {
    const before = Date.now();
    expect((await loadSignInChallenge()).status).toBe(200);
    expect((await loadSignInChallenge()).status).toBe(200);

    const rows = getDb().select().from(verification).all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const ttl = row.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(4 * MINUTE);
      expect(ttl).toBeLessThanOrEqual(5 * MINUTE + 5_000);
    }

    // Still valid now → kept; six minutes later → both gone.
    expect(pruneExpiredVerifications()).toBe(0);
    expect(pruneExpiredVerifications(new Date(before + 6 * MINUTE))).toBe(2);
    expect(identifiers()).toEqual([]);
  });

  it('deletes only rows whose expiresAt has passed', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    insertVerification('expired-challenge', new Date(now.getTime() - MINUTE));
    insertVerification('expired-long-ago', new Date(now.getTime() - 30 * 24 * 60 * MINUTE));
    insertVerification('live-challenge', new Date(now.getTime() + 4 * MINUTE));
    insertVerification('live-reset-token', new Date(now.getTime() + 60 * MINUTE));
    insertVerification('expires-exactly-now', now);

    expect(pruneExpiredVerifications(now)).toBe(2);
    expect(identifiers()).toEqual(['expires-exactly-now', 'live-challenge', 'live-reset-token']);
  });

  it('a live challenge still verifies after a prune (only dead rows go)', async () => {
    const response = await loadSignInChallenge();
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    insertVerification('stale', new Date(Date.now() - MINUTE));

    expect(pruneExpiredVerifications()).toBe(1);
    // The plugin still finds (and consumes) the live challenge: the bogus
    // credential fails at the passkey lookup, not with CHALLENGE_NOT_FOUND.
    const verify = await getAuth().handler(
      new Request('http://localhost:4998/api/auth/passkey/verify-authentication', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:4998' },
        body: JSON.stringify({ response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } }),
      }),
    );
    const body = (await verify.json()) as { code?: string };
    expect(body.code).toBe('PASSKEY_NOT_FOUND');
    expect(identifiers()).toEqual([]); // consumed by the plugin
  });

  it('logs failures instead of throwing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = getDb();
    vi.spyOn(db, 'delete').mockImplementationOnce(() => {
      throw new Error('disk I/O error');
    });
    expect(runVerificationPruneLogged('hourly')).toBe(0);
    expect(error).toHaveBeenCalledWith('[db] verification prune (hourly) FAILED:', expect.any(Error));
  });
});

describe('stale rate-limit pruning', () => {
  it('keeps rows for 24 h, which is at least twice every configured window', () => {
    const windowsMs = [
      AUTH_RATE_LIMIT.window,
      ...Object.values(AUTH_RATE_LIMIT.customRules).map((r) => r.window),
      10, // Better Auth's built-in /sign-in* rule
    ].map((s) => s * 1000);
    expect(rateLimitRowRetentionMs()).toBe(24 * HOUR);
    for (const w of windowsMs) expect(rateLimitRowRetentionMs()).toBeGreaterThanOrEqual(2 * w);
  });

  it('deletes only rows idle for longer than the retention', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    const t = now.getTime();
    insertRateLimit('203.0.113.7|/sign-in/email', t - 10_000, 9); // live bucket, mid-window
    insertRateLimit('203.0.113.8|/get-session', t - 2 * HOUR); // dead, but inside the retention
    insertRateLimit('203.0.113.9|/sign-in/email', t - 24 * HOUR); // exactly at the cutoff: kept
    insertRateLimit('198.51.100.1|/passkey/generate-authenticate-options', t - 24 * HOUR - 1);
    insertRateLimit('198.51.100.2|/sign-up/email', t - 30 * 24 * HOUR);

    expect(pruneStaleRateLimits(now)).toBe(2);
    expect(rateLimitKeys()).toEqual([
      '203.0.113.7|/sign-in/email',
      '203.0.113.8|/get-session',
      '203.0.113.9|/sign-in/email',
    ]);
    // The live bucket keeps its count: pruning never resets a window.
    const live = getDb().select().from(rateLimit).all().find((r) => r.key === '203.0.113.7|/sign-in/email');
    expect(live?.count).toBe(9);
  });

  it('leaves the bucket a real request just wrote in place', async () => {
    const response = await getAuth().handler(
      new Request('http://localhost:4998/api/auth/passkey/generate-authenticate-options', {
        headers: { 'cf-connecting-ip': '192.0.2.44' },
      }),
    );
    expect(response.status).toBe(200);
    const rows = getDb().select().from(rateLimit).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toContain('192.0.2.44');

    expect(pruneStaleRateLimits()).toBe(0);
    expect(getDb().select().from(rateLimit).all()).toEqual(rows);
    // A day and a bit later the idle bucket goes.
    expect(pruneStaleRateLimits(new Date(rows[0].lastRequest + 24 * HOUR + 1))).toBe(1);
  });

  it('logs failures instead of throwing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = getDb();
    vi.spyOn(db, 'delete').mockImplementationOnce(() => {
      throw new Error('disk I/O error');
    });
    expect(runRateLimitPruneLogged('hourly')).toBe(0);
    expect(error).toHaveBeenCalledWith('[db] rate-limit prune (hourly) FAILED:', expect.any(Error));
  });
});

describe('maintenance scheduler', () => {
  it('prunes at startup and hourly, and starts only once', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    insertVerification('dead-at-boot', new Date(Date.now() - MINUTE));
    insertRateLimit('192.0.2.1|/sign-in/email', Date.now() - 48 * HOUR);

    startMaintenanceScheduler();
    startMaintenanceScheduler();
    expect(log.mock.calls).toEqual([
      ['[db] pruned 1 expired verification row(s) (startup)'],
      ['[db] pruned 1 stale rate-limit row(s) (startup)'],
    ]);

    // Quiet hour: nothing expired, nothing logged.
    vi.advanceTimersByTime(60 * MINUTE);
    expect(log).toHaveBeenCalledTimes(2);

    insertVerification('dead-later', new Date(Date.now() - MINUTE));
    vi.advanceTimersByTime(60 * MINUTE);
    expect(log).toHaveBeenLastCalledWith('[db] pruned 1 expired verification row(s) (hourly)');
    expect(log).toHaveBeenCalledTimes(3);

    insertRateLimit('192.0.2.2|/sign-in/email', Date.now() - 25 * HOUR);
    vi.advanceTimersByTime(60 * MINUTE);
    expect(log).toHaveBeenLastCalledWith('[db] pruned 1 stale rate-limit row(s) (hourly)');
    expect(log).toHaveBeenCalledTimes(4);
    expect(identifiers()).toEqual([]);
    expect(rateLimitKeys()).toEqual([]);
  });

  it('a failing prune does not stop the other one', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = getDb();
    vi.spyOn(db, 'delete').mockImplementationOnce(() => {
      throw new Error('disk I/O error');
    });
    startMaintenanceScheduler();
    expect(error).toHaveBeenCalledWith('[db] verification prune (startup) FAILED:', expect.any(Error));
    expect(log).toHaveBeenCalledWith('[db] pruned 0 stale rate-limit row(s) (startup)');
  });
});
