import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock('next/headers', () => ({
  headers: async () => requestHeaders.current,
  cookies: async () => {
    throw new Error('`cookies` was called outside a request scope.');
  },
}));

import { useTempDataDir } from '@/test/temp-data-dir';
import { closeDb, getDb, getDbPath } from './client';
import { bootstrapDatabase } from './bootstrap';
import { isAuthSetupComplete, isFirstUserSetup, tombstoneEmail } from './user-store';
import { clearSetupFailure, getSetupFailure } from './setup-state';
import { user } from './schema';
import { getAuth, resetAuthForTests } from '@/lib/auth/server';
import { auth } from '@/lib/auth';
import { updateAppSettings } from '../app-settings';
import { POST as authRoutePost } from '@/app/api/auth/[...all]/route';

const ALEX_ID = '2f0c1d8e-4b7a-4c1e-9a3f-0d6b5e8c7a11';
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

/** A user's financial data dir (`users/<id>/`), as every existing install has. */
function writeUserDataDir(id = ALEX_ID) {
  const dir = path.join(tmp.dir, 'users', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'preferences.enc'), 'ciphertext');
}

/** A DB from an earlier boot holding Alex (optionally soft-deleted). */
function writeDbWithAlex({ deleted = false } = {}) {
  const now = new Date();
  getDb()
    .insert(user)
    .values({
      id: ALEX_ID,
      name: 'Alex',
      email: deleted ? tombstoneEmail(ALEX_ID) : 'alex@example.com',
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
      role: 'admin',
      isActive: !deleted,
      deletedAt: deleted ? now : null,
    })
    .run();
  closeDb();
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
  it('an existing DB with users and their data dirs completes setup', async () => {
    writeDbWithAlex();
    writeUserDataDir();
    const result = await bootstrapDatabase();
    expect(result).toEqual({ ok: true, dbUsable: true, dbDiscarded: false });
    expect(isAuthSetupComplete()).toBe(true);
    expect(isFirstUserSetup()).toBe(false);
  });

  it('a genuinely fresh install allows the first-user rule', async () => {
    expect((await bootstrapDatabase()).ok).toBe(true);
    expect(isFirstUserSetup()).toBe(true);
    const res = await getAuth().api.signUpEmail({ body: { name: 'Alex', email: 'alex@example.com', password: STRONG } });
    expect(getDb().select().from(user).all().find((u) => u.id === res.user.id)?.role).toBe('admin');
    expect(fs.existsSync(path.join(tmp.dir, 'users', res.user.id))).toBe(true);
    expect(isAuthSetupComplete()).toBe(true);
  });
});

describe('fail closed', () => {
  it('a lost DB next to user data: removes the new DB, blocks auth, recovers once a DB with the users is back', async () => {
    writeUserDataDir();

    const result = await bootstrapDatabase();
    expect(result).toEqual({ ok: false, dbUsable: false, dbDiscarded: true });
    expect(fs.existsSync(getDbPath())).toBe(false);
    expect(fs.existsSync(`${getDbPath()}-wal`)).toBe(false);
    expect(getSetupFailure()?.message).toMatch(/has no users/);
    // Never re-created in this process.
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

    // "Restore the snapshot", then restart.
    reset();
    writeDbWithAlex();
    expect((await bootstrapDatabase()).ok).toBe(true);
    expect(getDb().select().from(user).all().map((u) => u.id)).toEqual([ALEX_ID]);
  });

  it('wrong ENCRYPTION_KEY on an existing DB: leaves it untouched, recovers after a restart with the right key', async () => {
    writeDbWithAlex();
    writeUserDataDir();
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

    const result = await bootstrapDatabase();
    expect(result).toEqual({ ok: false, dbUsable: false, dbDiscarded: false });
    expect(fs.existsSync(getDbPath())).toBe(true);
    expect(getSetupFailure()).toBeDefined();

    reset();
    process.env.ENCRYPTION_KEY = goodKey;
    expect((await bootstrapDatabase()).ok).toBe(true);
    expect(getDb().select().from(user).all().map((u) => u.id)).toEqual([ALEX_ID]);
  });

  it('keeps a pre-existing empty DB but refuses sign-up and session creation (also after the process flag is gone)', async () => {
    getDb(); // a DB from an earlier boot without any users
    closeDb();
    writeUserDataDir();

    const result = await bootstrapDatabase();
    expect(result).toEqual({ ok: false, dbUsable: true, dbDiscarded: false });
    expect(fs.existsSync(getDbPath())).toBe(true);
    expect(getSetupFailure()?.message).toMatch(/1 data dir\(s\) but the account database has no users/);

    await updateAppSettings({ selfSignupEnabled: false }, 'test');
    await expect503(getAuth().api.signUpEmail({ body: { name: 'Mallory', email: 'mallory@example.com', password: STRONG } }));
    await expect503((await getAuth().$context).internalAdapter.createSession(ALEX_ID));

    // Even without the in-process flag (e.g. no instrumentation), the on-disk
    // check (user data dirs, no user rows) keeps it closed.
    clearSetupFailure();
    expect(isAuthSetupComplete()).toBe(false);
    expect(isFirstUserSetup()).toBe(false);
    await expect503(getAuth().api.signUpEmail({ body: { name: 'Mallory', email: 'mallory@example.com', password: STRONG } }));
  });

  it('an unreadable users/ fails the boot instead of counting as empty', async () => {
    fs.writeFileSync(path.join(tmp.dir, 'users'), 'not a directory');
    const result = await bootstrapDatabase();
    expect(result.ok).toBe(false);
    expect(getSetupFailure()?.message).toMatch(/ENOTDIR/);
  });
});

describe('first-user rule needs no user data at all', () => {
  it('a DB with only soft-deleted users does not grant admin or bypass the signup setting', async () => {
    writeDbWithAlex({ deleted: true });
    writeUserDataDir();
    expect((await bootstrapDatabase()).ok).toBe(true);
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
