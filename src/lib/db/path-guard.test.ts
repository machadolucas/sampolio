import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { useTempDataDir } from '@/test/temp-data-dir';
import { assertSafeId, assertChunkMonth, ensureDir, getUserDir, UnsafePathError } from './encryption';
import { getGoalById, deleteGoal, getGoals } from './goals';
import { putDoc } from './sqlite/docs';
import { goal } from './sqlite/schema';
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

  it('the user dir validates its id and ensureDir stays inside DATA_DIR', async () => {
    expect(getUserDir('alex')).toBe(path.join(tmp.dir, 'users', 'alex'));
    expect(() => getUserDir('../shared')).toThrow(UnsafePathError);
    const outside = path.join(tmp.dir, '..', 'sampolio-escape');
    await expect(ensureDir(outside)).rejects.toThrow(UnsafePathError);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('a DB module rejects a crafted id before it becomes a row key', async () => {
    putDoc(goal, { userId: 'sam', id: 'goal-1' }, { id: 'goal-1', name: 'Sam only' });

    await expect(getGoalById('alex', '../../sam/goal-1')).rejects.toThrow(UnsafePathError);
    await expect(getGoalById('../sam', 'goal-1')).rejects.toThrow(UnsafePathError);
    await expect(deleteGoal('alex', '../../../app-settings')).rejects.toThrow(UnsafePathError);
    await expect(
      deleteRate('mortgage-1', '../../../../users/sam/preferences')
    ).rejects.toThrow(UnsafePathError);
    await expect(getExpensesForMonths('group-1', ['../../group-2/expenses/2026-09'])).rejects.toThrow(
      UnsafePathError
    );

    expect((await getGoals('sam')).map((g) => g.name)).toEqual(['Sam only']);
  });
});
