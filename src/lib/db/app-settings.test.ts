import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTempDataDir } from '@/test/temp-data-dir';
import { closeDb } from './sqlite/client';
import { bootstrapDatabase } from './sqlite/bootstrap';
import { getAppSettings, isSelfSignupEnabled, updateAppSettings } from './app-settings';
import { createUser } from './users';

let tmp: ReturnType<typeof useTempDataDir>;

beforeAll(async () => {
  tmp = useTempDataDir('sampolio-app-settings-');
  closeDb();
  expect((await bootstrapDatabase()).ok).toBe(true);
});
afterAll(() => {
  closeDb();
  tmp.cleanup();
});

describe('app settings defaults (no app-settings.enc)', () => {
  it('allow sign-up only while no account exists, then fail closed', async () => {
    expect(await isSelfSignupEnabled()).toBe(true);

    await createUser('alex@example.com', 'Str0ng!pass', 'Alex');
    expect(await isSelfSignupEnabled()).toBe(false);
    expect((await getAppSettings()).updatedBy).toBe('system');
  });

  it('an explicit setting wins over the default', async () => {
    await updateAppSettings({ selfSignupEnabled: true }, 'admin');
    expect(await isSelfSignupEnabled()).toBe(true);
  });
});
