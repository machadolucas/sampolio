import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const migrateMock = vi.hoisted(() => ({ fail: true }));
vi.mock('./migrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./migrate')>();
  return {
    ...actual,
    runMigrations: (db: Parameters<typeof actual.runMigrations>[0]) => {
      if (migrateMock.fail) throw new Error('boom: migration failed');
      return actual.runMigrations(db);
    },
  };
});

import { useTempDataDir } from '@/test/temp-data-dir';
import { closeDb, getDb } from './client';

let tmp: ReturnType<typeof useTempDataDir>;
beforeAll(() => {
  tmp = useTempDataDir('sampolio-migrate-fail-');
  closeDb();
});
afterAll(() => {
  closeDb();
  tmp.cleanup();
});

describe('getDb when migrations throw', () => {
  it('closes the connection instead of leaking one per call, then recovers', () => {
    const close = vi.spyOn(Database.prototype, 'close');
    expect(() => getDb()).toThrow(/migration failed/);
    expect(() => getDb()).toThrow(/migration failed/);
    expect(close).toHaveBeenCalledTimes(2);

    migrateMock.fail = false;
    expect(() => getDb()).not.toThrow();
    close.mockRestore();
  });
});
