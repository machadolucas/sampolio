import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock('next/headers', () => ({
  headers: async () => requestHeaders.current,
  cookies: async () => {
    throw new Error('`cookies` was called outside a request scope.');
  },
}));

import { useTempDataDir } from '@/test/temp-data-dir';
import { writeEncryptedFile } from '../encryption';
import { closeDb, getDb, getDbPath } from './client';
import { bootstrapDatabase } from './bootstrap';
import { isAuthSetupComplete, isFirstUserSetup, isLegacyImportDone } from './legacy-import';
import { clearSetupFailure, getSetupFailure } from './setup-state';
import { user } from './schema';
import { getAuth, resetAuthForTests } from '@/lib/auth/server';
import { auth } from '@/lib/auth';
import { updateAppSettings } from '../app-settings';
import { POST as authRoutePost } from '@/app/api/auth/[...all]/route';

const ALEX_ID = '2f0c1d8e-4b7a-4c1e-9a3f-0d6b5e8c7a11';
const SAM_ID = '7a9e3b21-5c4d-4f6e-8b2a-1c3d5e7f9a22';
const STRONG = 'Str0ng!pass';

let tmp: ReturnType<typeof useTempDataDir>;
let goodKey: string;

function reset() {
  closeDb();
  resetAuthForTests();
  clearSetupFailure();
}

beforeEach(() => {
  reset();
  tmp = useTempDataDir('sampolio-bootstrap-test-');
  goodKey = process.env.ENCRYPTION_KEY!;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  reset();
  vi.restoreAllMocks();
  tmp.cleanup();
});

interface Fixture {
  index?: { id: string; email: string }[] | null;
  users?: Record<string, Record<string, unknown>>;
}

async function writeLegacy({ index = undefined, users = {} }: Fixture) {
  if (index !== null) {
    await writeEncryptedFile(path.join(tmp.dir, 'users-index.enc'), {
      users: index ?? Object.entries(users).map(([id, u]) => ({ id, email: u.email })),
    });
  }
  const hash = await bcrypt.hash('Legacy-Pass-1!', 4);
  for (const [id, u] of Object.entries(users)) {
    await writeEncryptedFile(path.join(tmp.dir, 'users', id, 'user.enc'), {
      id,
      name: 'Someone',
      passwordHash: hash,
      role: 'user',
      isActive: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      ...u,
    });
  }
}

async function expect503(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: { statusCode?: number; body?: { code?: string } }) => e,
  );
  expect(error?.statusCode).toBe(503);
  expect(error?.body?.code).toBe('SETUP_INCOMPLETE');
}

describe('bootstrap happy path', () => {
  it('imports and completes setup', async () => {
    await writeLegacy({ users: { [ALEX_ID]: { email: 'alex@example.com', role: 'admin' } } });
    const result = await bootstrapDatabase();
    expect(result).toEqual({ ok: true, dbUsable: true, dbDiscarded: false });
    expect(isLegacyImportDone()).toBe(true);
    expect(isAuthSetupComplete()).toBe(true);
    expect(isFirstUserSetup()).toBe(false);
  });

  it('a genuinely fresh install allows the first-user rule', async () => {
    expect((await bootstrapDatabase()).ok).toBe(true);
    expect(isFirstUserSetup()).toBe(true);
    const res = await getAuth().api.signUpEmail({ body: { name: 'Alex', email: 'alex@example.com', password: STRONG } });
    expect(getDb().select().from(user).all().find((u) => u.id === res.user.id)?.role).toBe('admin');
  });
});

describe('fail closed', () => {
  it('wrong ENCRYPTION_KEY on first boot: removes the new DB, blocks auth, recovers after a restart with the right key', async () => {
    await writeLegacy({ users: { [ALEX_ID]: { email: 'alex@example.com' } } });
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

    const result = await bootstrapDatabase();
    expect(result).toEqual({ ok: false, dbUsable: false, dbDiscarded: true });
    expect(fs.existsSync(getDbPath())).toBe(false);
    expect(fs.existsSync(`${getDbPath()}-wal`)).toBe(false);
    expect(getSetupFailure()?.message).toMatch(/unreadable/);
    // Never re-created under the wrong key in this process.
    expect(() => getDb()).toThrow(/Database unavailable/);
    expect(fs.existsSync(getDbPath())).toBe(false);

    // HTTP surface answers 503; auth() is null without touching the DB.
    const res = await authRoutePost(
      new Request('http://localhost:4998/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:4998' },
        body: JSON.stringify({ name: 'Mallory', email: 'mallory@example.com', password: STRONG }),
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'SETUP_INCOMPLETE' });
    expect(await auth()).toBeNull();

    // "Restart" with the correct key.
    reset();
    process.env.ENCRYPTION_KEY = goodKey;
    expect((await bootstrapDatabase()).ok).toBe(true);
    expect(getDb().select().from(user).all().map((u) => u.id)).toEqual([ALEX_ID]);
  });

  it('keeps a pre-existing DB but refuses sign-up and session creation (also after the process flag is gone)', async () => {
    getDb(); // a DB from an earlier boot, import never completed
    closeDb();
    await writeLegacy({ index: null, users: { [ALEX_ID]: { email: 'alex@example.com' } } });

    const result = await bootstrapDatabase();
    expect(result).toEqual({ ok: false, dbUsable: true, dbDiscarded: false });
    expect(fs.existsSync(getDbPath())).toBe(true);
    expect(getSetupFailure()?.message).toMatch(/users-index\.enc is missing/);
    expect(isLegacyImportDone()).toBe(false);
    expect(getDb().select().from(user).all()).toHaveLength(0); // nobody imported as soft-deleted

    await updateAppSettings({ selfSignupEnabled: false }, 'test');
    await expect503(getAuth().api.signUpEmail({ body: { name: 'Mallory', email: 'mallory@example.com', password: STRONG } }));
    await expect503((await getAuth().$context).internalAdapter.createSession(ALEX_ID));

    // Even without the in-process flag (e.g. no instrumentation), the on-disk
    // check (legacy data present, marker missing) keeps it closed.
    clearSetupFailure();
    expect(isAuthSetupComplete()).toBe(false);
    expect(isFirstUserSetup()).toBe(false);
    await expect503(getAuth().api.signUpEmail({ body: { name: 'Mallory', email: 'mallory@example.com', password: STRONG } }));
  });

  it.each([
    ['an indexed user without email', { users: { [ALEX_ID]: { email: '' } } }, /has no email/],
    [
      'two indexed users with the same email',
      { users: { [ALEX_ID]: { email: 'alex@example.com' }, [SAM_ID]: { email: 'ALEX@example.com' } } },
      /share the email/,
    ],
    ['an index entry without a user dir', { index: [{ id: SAM_ID, email: 'sam@example.com' }], users: {} }, /does not exist/],
    ['a user.enc whose id differs from its dir', { users: { [ALEX_ID]: { id: SAM_ID, email: 'alex@example.com' } } }, /different id/],
  ])('aborts on %s without writing the marker', async (_label, fixture, message) => {
    await writeLegacy(fixture as Fixture);
    const result = await bootstrapDatabase();
    expect(result.ok).toBe(false);
    expect(getSetupFailure()?.message).toMatch(message);
  });

  it('corrupt user.enc aborts', async () => {
    await writeLegacy({ users: { [ALEX_ID]: { email: 'alex@example.com' } } });
    fs.writeFileSync(path.join(tmp.dir, 'users', ALEX_ID, 'user.enc'), 'not-encrypted');
    expect((await bootstrapDatabase()).ok).toBe(false);
    expect(getSetupFailure()?.message).toMatch(/user\.enc is unreadable/);
  });

  it('an email already owned by another DB row aborts instead of silently dropping the user', async () => {
    getDb()
      .insert(user)
      .values({ id: SAM_ID, name: 'Sam', email: 'alex@example.com', emailVerified: false, createdAt: new Date(), updatedAt: new Date() })
      .run();
    closeDb();
    await writeLegacy({ users: { [ALEX_ID]: { email: 'alex@example.com' } } });
    expect((await bootstrapDatabase()).ok).toBe(false);
    expect(getSetupFailure()?.message).toMatch(/already belongs to DB user/);
    expect(isLegacyImportDone()).toBe(false);
  });
});

describe('first-user rule needs no legacy data at all', () => {
  it('an empty legacy index (all users soft-deleted) does not grant admin or bypass the signup setting', async () => {
    await writeLegacy({ index: [], users: { [ALEX_ID]: { email: 'alex@example.com' } } });
    const result = await bootstrapDatabase();
    expect(result.ok).toBe(true);
    // Only a soft-deleted row exists and legacy files are on disk.
    expect(isFirstUserSetup()).toBe(false);

    await updateAppSettings({ selfSignupEnabled: false }, 'test');
    const blocked = await getAuth()
      .api.signUpEmail({ body: { name: 'Mallory', email: 'mallory@example.com', password: STRONG } })
      .then(() => null, (e: { statusCode?: number; body?: { code?: string } }) => e);
    expect(blocked?.body?.code).toBe('SIGNUP_DISABLED');

    await updateAppSettings({ selfSignupEnabled: true }, 'test');
    const res = await getAuth().api.signUpEmail({ body: { name: 'Sam', email: 'sam@example.com', password: STRONG } });
    expect(getDb().select().from(user).all().find((u) => u.id === res.user.id)?.role).toBe('user');
  });
});
