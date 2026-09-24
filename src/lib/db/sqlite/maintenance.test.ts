import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTempDataDir } from '@/test/temp-data-dir';
import { getAuth, resetAuthForTests } from '@/lib/auth/server';
import { bootstrapDatabase } from './bootstrap';
import { closeDb, getDb } from './client';
import {
  pruneExpiredVerifications,
  runVerificationPruneLogged,
  startMaintenanceScheduler,
  stopMaintenanceScheduler,
} from './maintenance';
import { verification } from './schema';

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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  stopMaintenanceScheduler();
});

const MINUTE = 60_000;

function insertVerification(identifier: string, expiresAt: Date) {
  getDb()
    .insert(verification)
    .values({ id: crypto.randomUUID(), identifier, value: '{}', expiresAt })
    .run();
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

describe('maintenance scheduler', () => {
  it('prunes at startup and hourly, and starts only once', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    insertVerification('dead-at-boot', new Date(Date.now() - MINUTE));

    startMaintenanceScheduler();
    startMaintenanceScheduler();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[db] pruned 1 expired verification row(s) (startup)');

    // Quiet hour: nothing expired, nothing logged.
    vi.advanceTimersByTime(60 * MINUTE);
    expect(log).toHaveBeenCalledTimes(1);

    insertVerification('dead-later', new Date(Date.now() - MINUTE));
    vi.advanceTimersByTime(60 * MINUTE);
    expect(log).toHaveBeenLastCalledWith('[db] pruned 1 expired verification row(s) (hourly)');
    expect(identifiers()).toEqual([]);
  });
});
