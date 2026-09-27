import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  createSplitGroup,
  addExpense,
  updateExpense,
  deleteExpense,
  locateExpense,
  getExpensesForMonth,
  getSplitGroupSummary,
  rebuildSummary,
  upsertExpenseByOccurrence,
} from './split-groups';
import type { SplitExpense, SplitExpenseItem, SplitGroupSummary } from '@/types';

/**
 * Real disk round-trips of the chunked split storage: the delta-maintained
 * summary must always equal a full rebuild (PERF-03), and occurrence upserts
 * must not double-book a month for a drifted month-end rule (BUG-10).
 */
describe('split-groups db layer', () => {
  let dataDir: string;
  let groupId: string;
  const ALEX = 'alex';
  const SAM = 'sam';
  let seq = 0;

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `sampolio-split-test-${process.pid}`);
    process.env.DATA_DIR = dataDir;
    const group = await createSplitGroup(
      { userId: ALEX, email: 'alex@example.com', name: 'Alex' },
      { name: 'Household', currency: 'EUR' },
      [{ userId: SAM, email: 'sam@example.com', name: 'Sam', role: 'member' }],
    );
    groupId = group.id;
  });

  afterAll(async () => {
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  function row(date: string, amountCents: number, extra: Partial<SplitExpenseItem> = {}): SplitExpenseItem {
    seq += 1;
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString();
    return {
      kind: 'expense',
      id: `row-${seq}`,
      groupId,
      date,
      currency: 'EUR',
      netByUserId: { [ALEX]: amountCents / 2, [SAM]: -amountCents / 2 },
      source: 'manual',
      createdByUserId: ALEX,
      createdAt,
      updatedAt: createdAt,
      title: `Row ${seq}`,
      category: 'Groceries',
      amountCents,
      ...extra,
    };
  }

  // Readers use `?? 0`, so a zero net and a missing key are equivalent.
  const normalize = (s: SplitGroupSummary) => ({
    netByUserId: Object.fromEntries(Object.entries(s.netByUserId).filter(([, c]) => c !== 0)),
    expenseCount: s.expenseCount,
    paymentCount: s.paymentCount,
    lastActivityAt: s.lastActivityAt,
    monthsWithData: s.monthsWithData,
  });

  async function expectSummaryMatchesRebuild() {
    const delta = normalize(await getSplitGroupSummary(groupId));
    const rebuilt = normalize(await rebuildSummary(groupId));
    expect(delta).toEqual(rebuilt);
  }

  it('keeps the delta summary equal to a full rebuild across add, edit, move and delete', async () => {
    const a = await addExpense(groupId, row('2026-01-10', 1000));
    const b = await addExpense(groupId, row('2026-02-05', 2000));
    const c = await addExpense(groupId, row('2026-03-01', 3000));
    const payment: SplitExpense = {
      kind: 'payment',
      id: 'pay-1',
      groupId,
      date: '2026-03-02',
      currency: 'EUR',
      netByUserId: { [SAM]: 500, [ALEX]: -500 },
      source: 'manual',
      createdByUserId: SAM,
      createdAt: '2026-01-01T00:10:00.000Z',
      updatedAt: '2026-01-01T00:10:00.000Z',
      fromUserId: SAM,
      toUserId: ALEX,
      amountCents: 500,
    };
    await addExpense(groupId, payment);
    await expectSummaryMatchesRebuild();

    // Edit in place (same month), with a wrong month hint.
    await updateExpense(groupId, b.id, { ...b, amountCents: 2400, netByUserId: { [ALEX]: 1200, [SAM]: -1200 } }, '2026-03');
    await expectSummaryMatchesRebuild();

    // Move across months; the old chunk empties and is deleted.
    await updateExpense(groupId, a.id, { ...a, date: '2026-04-15' }, '2026-01');
    await expectSummaryMatchesRebuild();
    expect((await getSplitGroupSummary(groupId)).monthsWithData).not.toContain('2026-01');

    // Delete an older row, then the most recently created one (the
    // lastActivityAt holder, which forces the rebuild fallback).
    expect(await deleteExpense(groupId, c.id, '2026-03')).toBe(true);
    await expectSummaryMatchesRebuild();
    expect(await deleteExpense(groupId, payment.id)).toBe(true);
    await expectSummaryMatchesRebuild();
    expect(await deleteExpense(groupId, 'missing')).toBe(false);
  });

  it('locates rows via the month hint or a newest-first scan', async () => {
    const old = await addExpense(groupId, row('2025-06-01', 100));
    const recent = await addExpense(groupId, row('2026-06-01', 100));
    expect((await locateExpense(groupId, recent.id))?.ym).toBe('2026-06');
    expect((await locateExpense(groupId, old.id, '2025-06'))?.ym).toBe('2025-06');
    expect((await locateExpense(groupId, old.id, '2026-06'))?.ym).toBe('2025-06'); // wrong hint still finds it
    expect(await locateExpense(groupId, 'missing', '2026-06')).toBeNull();
  });

  it('overwrites an occurrence with a delta and skips a second row for the same rule in a month', async () => {
    const drifted = row('2026-07-28', 1000, { source: 'recurring', generatedFromRuleId: 'rule-1', occurrenceKey: 'rule-1:2026-07-28' });
    const first = await upsertExpenseByOccurrence(groupId, drifted, { onePerMonth: true });
    expect(first.created).toBe(true);
    await expectSummaryMatchesRebuild();

    // Same occurrence key → overwrite in place.
    const again = await upsertExpenseByOccurrence(
      groupId,
      { ...drifted, id: 'other-id', amountCents: 1200, netByUserId: { [ALEX]: 600, [SAM]: -600 } },
      { onePerMonth: true },
    );
    expect(again.created).toBe(false);
    expect(again.expense.id).toBe(drifted.id);
    await expectSummaryMatchesRebuild();

    // The corrected month-end date for the same month must not double-book July.
    const corrected = row('2026-07-31', 1000, { source: 'recurring', generatedFromRuleId: 'rule-1', occurrenceKey: 'rule-1:2026-07-31' });
    const skipped = await upsertExpenseByOccurrence(groupId, corrected, { onePerMonth: true });
    expect(skipped.skipped).toBe(true);
    const july = await getExpensesForMonth(groupId, '2026-07');
    expect(july.filter((r) => r.generatedFromRuleId === 'rule-1')).toHaveLength(1);

    // Without the flag (daily/weekly rules) a second row in the month is normal.
    const weekly = await upsertExpenseByOccurrence(groupId, corrected);
    expect(weekly.created).toBe(true);
    await expectSummaryMatchesRebuild();
  });
});
