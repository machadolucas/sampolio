import { describe, it, expect } from 'vitest';
import {
  liveAnchorAsOf,
  bookedInMonthThrough,
  startOfMonthFromLive,
  expectedLiveBalance,
  balanceBasis,
  resolveBalanceAsOf,
  bankSnapshotProvenance,
  liveAnchorOpeningBalance,
  anchorMonthOpeningBalance,
  anchorMonthActuals,
  shouldActualizeAnchorMonth,
} from './live-anchor';
import { calculateProjection } from './projection';
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
      actualBalance: live,
      monthStartBalance: 2000,
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
      actualBalance: 4050,
      monthStartBalance: 2000,
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
      actualBalance: 4200,
      monthStartBalance: 4200,
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
        actualBalance: 100,
        monthStartBalance: 100,
      })
    ).toBeNull();
  });
});

describe('balance basis and as-of date (R2-1)', () => {
  it('classifies booked, available and unknown balance types', () => {
    expect(['ITBD', 'CLBD', 'OPBD', 'PRCD'].map(balanceBasis)).toEqual(['booked', 'booked', 'booked', 'booked']);
    expect(['ITAV', 'XPCD', 'CLAV', 'OPAV', 'FWAV'].map(balanceBasis)).toEqual(
      Array(5).fill('available')
    );
    expect(balanceBasis('INFO')).toBe('unknown');
    expect(balanceBasis(undefined)).toBe('unknown');
  });

  it('uses the bank reference date, clamps a future one and shifts an opening balance back a day', () => {
    expect(resolveBalanceAsOf('CLBD', '2026-09-09', '2026-09-10')).toBe('2026-09-09');
    expect(resolveBalanceAsOf('ITBD', undefined, '2026-09-10')).toBe('2026-09-10');
    expect(resolveBalanceAsOf('ITBD', '2026-09-12', '2026-09-10')).toBe('2026-09-10');
    expect(resolveBalanceAsOf('OPBD', '2026-10-01', '2026-10-01')).toBe('2026-09-30');
    expect(resolveBalanceAsOf('OPBD', undefined, '2026-09-10')).toBe('2026-09-09');
  });
});

describe('bankSnapshotProvenance (write-time opening balance)', () => {
  const ledger = [
    tx({ bookingDate: '2026-09-03', amount: -800, counterpartyName: 'Rent' }),
    tx({ bookingDate: '2026-09-10', amount: -100, counterpartyName: 'S-Market' }),
  ];

  it('a CLBD for the previous day excludes the sync day bookings', () => {
    // Sept 10 sync, CLBD = Sept 9 close €1,200 (rent paid; today's €100 not in it).
    const p = bankSnapshotProvenance({
      balance: { amount: 1200, type: 'CLBD', referenceDate: '2026-09-09' },
      syncDate: '2026-09-10',
      month: '2026-09',
      transactions: ledger,
    });
    expect(p).toEqual({ balanceType: 'CLBD', balanceAsOf: '2026-09-09', monthStartBalance: 2000 });
  });

  it("a CLBD for the previous month's last day is already the month's opening balance", () => {
    // Oct 1 sync returns September's close €1,000 alongside an Oct 1 debit of €100.
    const p = bankSnapshotProvenance({
      balance: { amount: 1000, type: 'CLBD', referenceDate: '2026-09-30' },
      syncDate: '2026-10-01',
      month: '2026-10',
      transactions: [tx({ bookingDate: '2026-10-01', amount: -100 })],
    });
    expect(p.balanceAsOf).toBe('2026-09-30');
    expect(p.monthStartBalance).toBe(1000); // not €1,100
  });

  it('a balance older than the month start adds the bookings in between', () => {
    const p = bankSnapshotProvenance({
      balance: { amount: 1000, type: 'CLBD', referenceDate: '2026-09-28' },
      syncDate: '2026-10-02',
      month: '2026-10',
      transactions: [tx({ bookingDate: '2026-09-29', amount: -50 }), tx({ bookingDate: '2026-10-01', amount: -100 })],
    });
    expect(p.monthStartBalance).toBe(950);
  });

  it('an ITAV fallback strips the pending rows before deriving the booked opening balance', () => {
    // Only ITAV served: €1,050 = booked €1,100 − a €50 pending hold.
    const p = bankSnapshotProvenance({
      balance: { amount: 1050, type: 'ITAV' },
      syncDate: '2026-09-10',
      month: '2026-09',
      transactions: [...ledger, tx({ bookingDate: '2026-09-09', amount: -50, status: 'pending' })],
    });
    expect(p).toEqual({ balanceType: 'ITAV', balanceAsOf: '2026-09-10', monthStartBalance: 2000 });
  });

  it('R5-3: a historical OPAV does not subtract today\'s pendings and flags its opening as an estimate', () => {
    // Sep 30: booked €1,000 with a €100 hold ⇒ available €900. The Oct 1 sync
    // returns OPAV €900 (as of Sep 30); the hold has since booked on Oct 1, so
    // the ledger holds no pending row any more.
    const p = bankSnapshotProvenance({
      balance: { amount: 900, type: 'OPAV', referenceDate: '2026-10-01' },
      syncDate: '2026-10-01',
      month: '2026-10',
      transactions: [
        tx({ bookingDate: '2026-10-01', amount: -100, counterpartyName: 'Hold' }),
        tx({ bookingDate: '2026-10-01', amount: -30, status: 'pending' }), // a new hold, not in the Sep 30 balance
      ],
    });
    expect(p.balanceAsOf).toBe('2026-09-30');
    // The Sep 30 pending set is unknowable: today's €30 hold is NOT stripped,
    // and the opening (€900, truly €1,000) is flagged as an estimate.
    expect(p.monthStartBalance).toBe(900);
    expect(p.openingIsEstimate).toBe(true);
  });

  it('a same-day available balance is authoritative (no estimate flag)', () => {
    const p = bankSnapshotProvenance({
      balance: { amount: 1050, type: 'CLAV', referenceDate: '2026-09-10' },
      syncDate: '2026-09-10',
      month: '2026-09',
      transactions: [...ledger, tx({ bookingDate: '2026-09-09', amount: -50, status: 'pending' })],
    });
    expect(p.monthStartBalance).toBe(2000);
    expect(p.openingIsEstimate).toBeUndefined();
  });

  it('an ITBD keeps every booking through the sync day', () => {
    const p = bankSnapshotProvenance({
      balance: { amount: 1100, type: 'ITBD' },
      syncDate: '2026-09-10',
      month: '2026-09',
      transactions: [...ledger, tx({ bookingDate: '2026-09-09', amount: -50, status: 'pending' })],
    });
    expect(p.monthStartBalance).toBe(2000);
  });
});

describe('same-day second sync (R2-2)', () => {
  const account = createMockAccount({ id: 'acc', startingDate: '2026-01', startingBalance: 0, planningHorizonMonths: 24 });
  const rent = tx({ bookingDate: '2026-09-03', amount: -800, counterpartyName: 'Rent' });
  const afternoonDebit = tx({ bookingDate: '2026-09-10', amount: -100, counterpartyName: 'S-Market' });

  it('measures the afternoon sync against the stored morning opening balance — no false variance', () => {
    // Morning: ITBD €1,200, ledger has only the rent.
    const morning = bankSnapshotProvenance({
      balance: { amount: 1200, type: 'ITBD' },
      syncDate: '2026-09-10',
      month: '2026-09',
      transactions: [rent],
    });
    const priorSnapshot = createMockSnapshot({
      entityId: 'acc',
      yearMonth: '2026-09',
      actualBalance: 1200,
      source: 'bank-sync',
      createdAt: '2026-09-10T06:00:00.000Z',
      ...morning,
    });
    // Afternoon: a €100 debit booked the same day, ITBD €1,100.
    const ledger = [rent, afternoonDebit];
    const afternoon = bankSnapshotProvenance({
      balance: { amount: 1100, type: 'ITBD' },
      syncDate: '2026-09-10',
      month: '2026-09',
      transactions: ledger,
    });
    const expected = expectedLiveBalance({
      account,
      recurringItems: [],
      plannedItems: [],
      taxedIncomes: [],
      priorSnapshot,
      transactions: ledger,
      month: '2026-09',
      actualBalance: 1100,
      monthStartBalance: afternoon.monthStartBalance,
    });
    expect(liveAnchorOpeningBalance(priorSnapshot, ledger, '2026-09-10')).toBe(2000);
    expect(expected).toBe(1100);
    expect(1100 - expected!).toBe(0);
  });

  it('a legacy prior snapshot (no stored fields) keeps the createdAt-date reconstruction', () => {
    const legacy = createMockSnapshot({
      entityId: 'acc',
      yearMonth: '2026-09',
      actualBalance: 1200,
      source: 'bank-sync',
      createdAt: '2026-09-10T06:00:00.000Z',
    });
    expect(liveAnchorAsOf('2026-01', legacy)).toBe('2026-09-10');
    // Reconstructed from today's ledger: the afternoon debit is (wrongly but
    // compatibly) treated as part of the morning balance.
    expect(liveAnchorOpeningBalance(legacy, [rent, afternoonDebit], '2026-09-10')).toBe(2100);
    expect(anchorMonthOpeningBalance('2026-01', 0, legacy, [rent, afternoonDebit])).toBe(2100);
  });
});

describe('anchorMonthOpeningBalance / anchorMonthActuals (one actualized-month rule)', () => {
  const ledger = [
    tx({ bookingDate: '2026-08-31', amount: -40 }), // previous month
    tx({ bookingDate: '2026-09-03', amount: -800 }),
    tx({ bookingDate: '2026-09-10', amount: -100 }),
    tx({ bookingDate: '2026-09-09', amount: -50, status: 'pending' }),
    tx({ bookingDate: '2026-09-11', amount: -25 }), // after the as-of date
  ];

  it('O is the stored monthStartBalance for a bank-sync snapshot', () => {
    const snap = createMockSnapshot({
      yearMonth: '2026-09',
      actualBalance: 1050, // ITAV, a €50 hold inside
      source: 'bank-sync',
      createdAt: '2026-09-10T06:00:00.000Z',
      balanceType: 'ITAV',
      balanceAsOf: '2026-09-10',
      monthStartBalance: 2000,
    });
    expect(anchorMonthOpeningBalance('2026-01', 0, snap, ledger)).toBe(2000);
  });

  it('O is the balance itself for a manual snapshot or the genesis', () => {
    const manual = createMockSnapshot({ yearMonth: '2026-09', actualBalance: 500, source: 'manual', monthStartBalance: 1 });
    expect(anchorMonthOpeningBalance('2026-01', 0, manual, ledger)).toBe(500);
    expect(anchorMonthOpeningBalance('2026-09', 750, null, ledger)).toBe(750);
  });

  it('actuals carry O and EVERY booked row of the month — no as-of cutoff, no pendings', () => {
    const a = anchorMonthActuals('2026-09', 2000, ledger);
    expect(a.openingBalance).toBe(2000);
    expect(a.transactions.map((t) => t.amount)).toEqual([-800, -100, -25]);
  });

  it('shouldActualizeAnchorMonth: current month for any anchor, earlier month only when live', () => {
    expect(shouldActualizeAnchorMonth('2026-09', null, '2026-09')).toBe(true);
    expect(shouldActualizeAnchorMonth('2026-08', '2026-08-20', '2026-09')).toBe(true);
    expect(shouldActualizeAnchorMonth('2026-08', null, '2026-09')).toBe(false);
  });
});

describe('R5-1: a booking after the balance cutoff is kept in the forecast', () => {
  it('Oct 1 sync with a Sep 30 CLBD €1,000 and an Oct 1 unplanned debit €100 ends October at €900', () => {
    const account = createMockAccount({ id: 'acc', startingDate: '2026-01', startingBalance: 0, planningHorizonMonths: 3 });
    const ledger = [tx({ bookingDate: '2026-10-01', amount: -100, counterpartyName: 'Kiosk' })];
    const provenance = bankSnapshotProvenance({
      balance: { amount: 1000, type: 'CLBD', referenceDate: '2026-09-30' },
      syncDate: '2026-10-01',
      month: '2026-10',
      transactions: ledger,
    });
    expect(provenance.monthStartBalance).toBe(1000);
    const snap = createMockSnapshot({
      entityId: 'acc',
      yearMonth: '2026-10',
      actualBalance: 1000,
      source: 'bank-sync',
      createdAt: '2026-10-01T06:00:00.000Z',
      ...provenance,
    });
    const actuals = anchorMonthActuals('2026-10', anchorMonthOpeningBalance('2026-01', 0, snap, ledger), ledger);
    const oct = calculateProjection(account, [], [], [], undefined, snap, [], [], [], actuals)[0];
    expect(oct.startingBalance).toBe(900); // O €1,000 + the €100 debit
    expect(oct.openingBalance).toBe(1000);
    expect(oct.endingBalance).toBe(900); // was €1,000 (debit dropped)
  });
});

describe('stale prior anchor with a stored opening (R2-2, month boundary)', () => {
  it('counts a row booked on the prior as-of day after that sync exactly once', () => {
    const account = createMockAccount({ id: 'acc', startingDate: '2026-01', startingBalance: 0, planningHorizonMonths: 24 });
    const salary = createMockRecurringItem({ type: 'income', name: 'Salary', amount: 3000, startDate: '2026-01' });
    const rent = createMockRecurringItem({ type: 'expense', name: 'Rent', amount: 800, category: 'Housing', startDate: '2026-01' });
    // Aug 20 morning sync: ITBD €1,200 (rent paid), opening €2,000 stored.
    const priorSnapshot = createMockSnapshot({
      entityId: 'acc',
      yearMonth: '2026-08',
      actualBalance: 1200,
      source: 'bank-sync',
      createdAt: SYNC_AUG_20,
      balanceType: 'ITBD',
      balanceAsOf: '2026-08-20',
      monthStartBalance: 2000,
    });
    const ledger = [
      tx({ bookingDate: '2026-08-03', amount: -800, counterpartyName: 'Rent' }),
      tx({ bookingDate: '2026-08-20', amount: -100, counterpartyName: 'Kiosk' }), // booked after that sync
    ];
    const expected = expectedLiveBalance({
      account,
      recurringItems: [salary, rent],
      plannedItems: [],
      taxedIncomes: [],
      priorSnapshot,
      transactions: ledger,
      month: '2026-09',
      actualBalance: 4100,
      monthStartBalance: 4100,
    });
    // Aug 20 close really was €1,100; + outstanding salary = €4,100 → no drift.
    expect(expected).toBe(4100);
  });
});
