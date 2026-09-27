import { describe, it, expect } from 'vitest';
import {
  liveAnchorAsOf,
  bookedInMonthThrough,
  startOfMonthFromLive,
  expectedLiveBalance,
} from './live-anchor';
import { createMockAccount, createMockRecurringItem, createMockSnapshot } from '@/test/mocks';
import type { BankTransaction } from '@/types';

let n = 0;
function tx(partial: Partial<BankTransaction> & { bookingDate: string; amount: number }): BankTransaction {
  n += 1;
  return {
    id: `tx-${n}`,
    linkedAccountId: 'link-1',
    dedupKey: `dk-${n}`,
    currency: 'EUR',
    status: 'booked',
    firstSeenAt: '2026-09-01T00:00:00Z',
    lastSeenAt: '2026-09-01T00:00:00Z',
    ...partial,
  };
}

// Mid-day UTC timestamps keep the server-local as-of date stable in any zone.
const SYNC_SEPT_10 = '2026-09-10T11:00:00.000Z';
const SYNC_AUG_20 = '2026-08-20T11:00:00.000Z';

describe('liveAnchorAsOf', () => {
  it('returns the local as-of date only for a bank-sync snapshot at/after genesis', () => {
    expect(liveAnchorAsOf('2026-01', createMockSnapshot({ yearMonth: '2026-09', source: 'bank-sync', createdAt: SYNC_SEPT_10 }))).toBe('2026-09-10');
    expect(liveAnchorAsOf('2026-01', createMockSnapshot({ yearMonth: '2026-09', source: 'manual', createdAt: SYNC_SEPT_10 }))).toBeNull();
    expect(liveAnchorAsOf('2026-01', createMockSnapshot({ yearMonth: '2026-09', createdAt: SYNC_SEPT_10 }))).toBeNull();
    expect(liveAnchorAsOf('2026-10', createMockSnapshot({ yearMonth: '2026-09', source: 'bank-sync', createdAt: SYNC_SEPT_10 }))).toBeNull();
    expect(liveAnchorAsOf('2026-01', null)).toBeNull();
  });
});

describe('bookedInMonthThrough / startOfMonthFromLive', () => {
  const txs = [
    tx({ bookingDate: '2026-08-31', amount: -40 }), // previous month
    tx({ bookingDate: '2026-09-02', amount: -500 }),
    tx({ bookingDate: '2026-09-05', amount: -20, status: 'pending' }), // pending never counts
    tx({ bookingDate: '2026-09-25', amount: 3000 }),
    tx({ bookingDate: '2026-09-28', amount: -99 }), // after the as-of date
  ];

  it('keeps booked rows of the month on or before the as-of date', () => {
    expect(bookedInMonthThrough(txs, '2026-09', '2026-09-27').map((t) => t.amount)).toEqual([-500, 3000]);
    expect(bookedInMonthThrough(txs, '2026-09', null).map((t) => t.amount)).toEqual([-500, 3000, -99]);
  });

  it('subtracts the month-to-date booked net from the live balance', () => {
    // €1,000 live on Sept 27 after a €3,000 salary and €500 of spending ⇒ opened at −€1,500.
    expect(startOfMonthFromLive(1000, txs, '2026-09', '2026-09-27')).toBe(-1500);
  });
});

describe('expectedLiveBalance (bank-sync snapshot variance)', () => {
  const account = createMockAccount({ id: 'acc', startingDate: '2026-01', startingBalance: 0, planningHorizonMonths: 24 });
  const salary = createMockRecurringItem({ type: 'income', name: 'Salary', amount: 3000, startDate: '2026-01' });
  const rent = createMockRecurringItem({ type: 'expense', name: 'Rent', amount: 800, category: 'Housing', startDate: '2026-01' });

  it('an on-plan account shows no variance on a mid-month sync before payday', () => {
    // Opening balance €2,000 (manual check-in); Sept 10: rent paid, salary not yet.
    const priorSnapshot = createMockSnapshot({ entityId: 'acc', yearMonth: '2026-09', actualBalance: 2000, source: 'manual' });
    const transactions = [tx({ bookingDate: '2026-09-03', amount: -800, counterpartyName: 'Rent' })];
    const live = 1200;
    const expected = expectedLiveBalance({
      account,
      recurringItems: [salary, rent],
      plannedItems: [],
      taxedIncomes: [],
      priorSnapshot,
      transactions,
      month: '2026-09',
      asOf: '2026-09-10',
    });
    // Old behaviour compared €1,200 with the end-of-month €4,200 (−€3,000 "variance").
    expect(expected).toBe(1200);
    expect(live - expected!).toBe(0);
  });

  it("a later sync in the same month measures against that month's own opening balance", () => {
    const priorSnapshot = createMockSnapshot({
      entityId: 'acc',
      yearMonth: '2026-09',
      actualBalance: 1200, // live on Sept 10
      source: 'bank-sync',
      createdAt: SYNC_SEPT_10,
    });
    const transactions = [
      tx({ bookingDate: '2026-09-03', amount: -800, counterpartyName: 'Rent' }),
      tx({ bookingDate: '2026-09-25', amount: 3000, counterpartyName: 'Salary' }),
      tx({ bookingDate: '2026-09-26', amount: -150, counterpartyName: 'S-Market' }),
    ];
    const expected = expectedLiveBalance({
      account,
      recurringItems: [salary, rent],
      plannedItems: [],
      taxedIncomes: [],
      priorSnapshot,
      transactions,
      month: '2026-09',
      asOf: '2026-09-27',
    });
    // Opening €2,000 + booked net €2,050 = €4,050 = the live balance.
    expect(expected).toBe(4050);
  });

  it('a stale live anchor from an earlier month is actualized, not re-forecast in full', () => {
    // Last sync Aug 20: €1,200 live, rent already paid, salary (Aug 25) still ahead.
    const priorSnapshot = createMockSnapshot({
      entityId: 'acc',
      yearMonth: '2026-08',
      actualBalance: 1200,
      source: 'bank-sync',
      createdAt: SYNC_AUG_20,
    });
    const transactions = [tx({ bookingDate: '2026-08-03', amount: -800, counterpartyName: 'Rent' })];
    const expected = expectedLiveBalance({
      account,
      recurringItems: [salary, rent],
      plannedItems: [],
      taxedIncomes: [],
      priorSnapshot,
      transactions,
      month: '2026-09',
      asOf: '2026-09-01',
    });
    // Sept opens at €1,200 + outstanding Aug salary €3,000 = €4,200 (rent not charged twice).
    expect(expected).toBe(4200);
  });

  it('returns null when the prior anchor lies after the month', () => {
    const priorSnapshot = createMockSnapshot({ entityId: 'acc', yearMonth: '2026-10', actualBalance: 100, source: 'manual' });
    expect(
      expectedLiveBalance({
        account,
        recurringItems: [],
        plannedItems: [],
        taxedIncomes: [],
        priorSnapshot,
        transactions: [],
        month: '2026-09',
        asOf: '2026-09-27',
      })
    ).toBeNull();
  });
});
