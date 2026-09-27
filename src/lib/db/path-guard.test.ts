import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { useTempDataDir } from '@/test/temp-data-dir';
import {
  assertSafeId,
  assertChunkMonth,
  entityPath,
  entityDir,
  getUserDir,
  readEncryptedFile,
  writeEncryptedFile,
  deleteFile,
  listFiles,
  UnsafePathError,
} from './encryption';
import { getGoalById, deleteGoal } from './goals';
import { deleteRate } from './shared-mortgages';
import { getExpensesForMonths } from './split-groups';

const TRAVERSALS = [
  '../../../app-settings',
  '../other-user/preferences',
  '..',
  'a/b',
  'a\\b',
  '',
  'x'.repeat(65),
  'goal.enc',
  '%2e%2e',
];

describe('DB path guard', () => {
  let tmp: { dir: string; cleanup: () => void };
  beforeAll(() => {
    tmp = useTempDataDir('sampolio-path-guard-');
  });
  afterAll(() => tmp.cleanup());

  it('accepts uuid v4 and slug ids, rejects traversal and separators', () => {
    expect(assertSafeId('3f1c2b9e-8d7a-4c3b-9a1e-0f2d4c6b8a10')).toBe('3f1c2b9e-8d7a-4c3b-9a1e-0f2d4c6b8a10');
    expect(assertSafeId('goal-1')).toBe('goal-1');
    expect(assertSafeId('link_a')).toBe('link_a');
    for (const bad of TRAVERSALS) expect(() => assertSafeId(bad), bad).toThrow(UnsafePathError);
    expect(() => assertSafeId(undefined)).toThrow(UnsafePathError);
    expect(() => assertSafeId(42)).toThrow(UnsafePathError);
  });

  it('chunk months must be YYYY-MM', () => {
    expect(assertChunkMonth('2026-09')).toBe('2026-09');
    for (const bad of ['../../g2/expenses/2026-09', '2026-9', '2026-09.enc', '']) {
      expect(() => assertChunkMonth(bad), bad).toThrow(UnsafePathError);
    }
  });

  it('builders validate the id segment', () => {
    const dir = path.join(tmp.dir, 'users', 'alex', 'goals');
    expect(entityPath(dir, 'goal-1')).toBe(path.join(dir, 'goal-1.enc'));
    expect(entityPath(dir, 'c1', '.session.enc')).toBe(path.join(dir, 'c1.session.enc'));
    expect(entityDir(dir, 'goal-1')).toBe(path.join(dir, 'goal-1'));
    expect(() => entityPath(dir, '../../../app-settings')).toThrow(UnsafePathError);
    expect(() => entityDir(dir, '../x')).toThrow(UnsafePathError);
    expect(() => getUserDir('../shared')).toThrow(UnsafePathError);
  });

  it('file primitives refuse paths outside DATA_DIR', async () => {
    const outside = path.join(tmp.dir, '..', 'sampolio-escape.enc');
    await expect(writeEncryptedFile(outside, { x: 1 })).rejects.toThrow(UnsafePathError);
    await expect(readEncryptedFile(outside)).rejects.toThrow(UnsafePathError);
    await expect(deleteFile(outside)).rejects.toThrow(UnsafePathError);
    await expect(listFiles(path.join(tmp.dir, '..'))).rejects.toThrow(UnsafePathError);
    // DATA_DIR itself is not a file target either.
    await expect(readEncryptedFile(tmp.dir)).rejects.toThrow(UnsafePathError);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('a per-entity DB builder cannot reach another user or a global file', async () => {
    const settings = path.join(tmp.dir, 'app-settings.enc');
    await writeEncryptedFile(settings, { selfSignupEnabled: false });
    const victimPrefs = path.join(getUserDir('sam'), 'preferences.enc');
    await writeEncryptedFile(victimPrefs, { secret: 'sam-only' });

    await expect(getGoalById('alex', '../../sam/preferences')).rejects.toThrow(UnsafePathError);
    await expect(deleteGoal('alex', '../../../app-settings')).rejects.toThrow(UnsafePathError);
    await expect(
      deleteRate('mortgage-1', '../../../../users/sam/preferences')
    ).rejects.toThrow(UnsafePathError);
    await expect(getExpensesForMonths('group-1', ['../../group-2/expenses/2026-09'])).rejects.toThrow(
      UnsafePathError
    );

    expect(fs.existsSync(settings)).toBe(true);
    expect(await readEncryptedFile(victimPrefs)).toEqual({ secret: 'sam-only' });
  });
});
