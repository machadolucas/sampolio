import { describe, expect, it } from 'vitest';
import type { SplitExpenseItem, SplitGroupSummary, SplitMemberBalance } from '@/types';
import {
  applySavedSplitBalances,
  applySavedSplitSummary,
  isCurrentSplitRead,
  mergeSavedSplitExpense,
  reconcileSavedSplitRows,
  visibleSplitMonthCount,
} from './split-ui-state';

const oldExpense: SplitExpenseItem = {
  kind: 'expense',
  id: 'saved-row',
  groupId: 'group-1',
  date: '2026-10-01',
  currency: 'EUR',
  netByUserId: { alex: 500, sam: -500 },
  source: 'manual',
  createdByUserId: 'alex',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  title: 'Lunch',
  category: 'Food',
  amountCents: 1000,
};

const summary: SplitGroupSummary = {
  groupId: 'group-1',
  netByUserId: { alex: 500, sam: -500 },
  expenseCount: 1,
  paymentCount: 0,
  lastActivityAt: oldExpense.createdAt,
  monthsWithData: ['2026-10'],
  updatedAt: oldExpense.createdAt,
};

describe('split UI saved-row state', () => {
  it('keeps a newly saved backdated month visible and updates summary and balances immediately', () => {
    const saved: SplitExpenseItem = {
      ...oldExpense,
      id: 'backdated-row',
      date: '2023-04-18',
      createdAt: '2026-11-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
      netByUserId: { alex: 700, sam: -700 },
      amountCents: 1400,
      title: 'Old receipt entered today',
    };
    const rows = mergeSavedSplitExpense([], saved);
    const nextSummary = applySavedSplitSummary(summary, undefined, saved);
    const balances: SplitMemberBalance[] = [
      { userId: 'alex', name: 'Alex', netCents: 500 },
      { userId: 'sam', name: 'Sam', netCents: -500 },
    ];

    expect(rows.map((row) => row.id)).toEqual(['backdated-row']);
    expect(nextSummary.monthsWithData).toEqual(['2023-04', '2026-10']);
    expect(nextSummary.expenseCount).toBe(2);
    expect(nextSummary.netByUserId).toEqual({ alex: 1200, sam: -1200 });
    expect(applySavedSplitBalances(balances, undefined, saved).map((row) => row.netCents)).toEqual([1200, -1200]);
  });

  it('upserts repeated saved ids and invalidates reads started before the save', () => {
    const edited = { ...oldExpense, amountCents: 1600, netByUserId: { alex: 800, sam: -800 } };
    expect(mergeSavedSplitExpense([oldExpense], edited)).toHaveLength(1);
    expect(applySavedSplitSummary(summary, oldExpense, edited)).toMatchObject({
      expenseCount: 1,
      netByUserId: { alex: 800, sam: -800 },
    });
    expect(isCurrentSplitRead(4, 5)).toBe(false);
    expect(isCurrentSplitRead(5, 5)).toBe(true);
  });

  it('reveals an older saved month and retires its pin after that month is authoritatively read', () => {
    expect(visibleSplitMonthCount(['2026-11', '2026-10', '2026-09', '2025-12'], '2023-04', 3)).toBe(5);
    const backdated = { ...oldExpense, date: '2023-04-18', id: 'backdated' };
    const immediate = reconcileSavedSplitRows([], [backdated], ['2026-11', '2026-10']);
    expect(immediate.rows.map((row) => row.id)).toEqual(['backdated']);
    expect(immediate.remainingPins).toEqual([backdated]);

    const confirmedAbsent = reconcileSavedSplitRows([], immediate.remainingPins, ['2023-04']);
    expect(confirmedAbsent.rows).toEqual([]);
    expect(confirmedAbsent.remainingPins).toEqual([]);
  });

  it('prefers the canonical row over a pinned copy with the same id', () => {
    const pinned = { ...oldExpense, title: 'Pinned title' };
    const canonical = { ...oldExpense, title: 'Fresh title' };
    const result = reconcileSavedSplitRows([canonical], [pinned], ['2026-10']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ kind: 'expense', title: 'Fresh title' });
    expect(result.remainingPins).toEqual([]);
  });
});
