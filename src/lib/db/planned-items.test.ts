import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createPlannedItem, getPlannedItemById, updatePlannedItem } from './planned-items';

/**
 * Regression tests for the occurrence-override duplication bug: `createPlannedItem`
 * used to silently drop the override / shared / reimbursement fields, so an
 * override was read back as a plain one-off and double-counted (and re-edits
 * created fresh duplicates because the find-by-flags lookup never matched).
 *
 * These exercise the real disk round-trip (encrypted write → decrypt read).
 */
describe('createPlannedItem field persistence', () => {
  let dataDir: string;
  const userId = 'test-user';
  const accountId = 'test-account';

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `sampolio-planned-test-${process.pid}`);
    process.env.DATA_DIR = dataDir;
  });

  afterAll(async () => {
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('persists recurring-occurrence-override metadata', async () => {
    const created = await createPlannedItem(userId, {
      accountId,
      type: 'expense',
      kind: 'one-off',
      name: 'Credit card (March)',
      amount: 1500,
      scheduledDate: '2026-03',
      linkedRecurringItemId: 'recurring-cc',
      isRecurringOverride: true,
      skipOccurrence: false,
    });

    const readBack = await getPlannedItemById(userId, accountId, created.id);
    expect(readBack).not.toBeNull();
    // The bug: these came back undefined, so the projection treated the row as a
    // plain one-off and added it ON TOP of the recurring occurrence.
    expect(readBack!.isRecurringOverride).toBe(true);
    expect(readBack!.linkedRecurringItemId).toBe('recurring-cc');
    expect(readBack!.skipOccurrence).toBe(false);
  });

  it('persists shared-expense and reimbursement fields', async () => {
    const created = await createPlannedItem(userId, {
      accountId,
      type: 'expense',
      kind: 'one-off',
      name: 'Shared, reimbursable',
      amount: 200,
      scheduledDate: '2026-04',
      isShared: true,
      shareRatio: 0.5,
      isReimbursable: true,
      expectedReimbursementMonth: '2026-05',
    });

    const readBack = await getPlannedItemById(userId, accountId, created.id);
    expect(readBack!.isShared).toBe(true);
    expect(readBack!.shareRatio).toBe(0.5);
    expect(readBack!.isReimbursable).toBe(true);
    expect(readBack!.reimbursementStatus).toBe('pending');
    expect(readBack!.expectedReimbursementMonth).toBe('2026-05');
  });

  it('lets an override be found and updated in place (no duplicate on re-edit)', async () => {
    const created = await createPlannedItem(userId, {
      accountId,
      type: 'expense',
      kind: 'one-off',
      name: 'CC override',
      amount: 1500,
      scheduledDate: '2026-06',
      linkedRecurringItemId: 'recurring-cc-2',
      isRecurringOverride: true,
    });

    // Simulate the upsert's find-predicate against persisted data.
    const found = await getPlannedItemById(userId, accountId, created.id);
    expect(
      found!.isRecurringOverride &&
        found!.linkedRecurringItemId === 'recurring-cc-2' &&
        found!.scheduledDate === '2026-06'
    ).toBe(true);

    const updated = await updatePlannedItem(userId, accountId, created.id, { amount: 1650 });
    expect(updated!.amount).toBe(1650);
    expect(updated!.isRecurringOverride).toBe(true); // preserved through update
    expect(updated!.linkedRecurringItemId).toBe('recurring-cc-2');
  });
});
