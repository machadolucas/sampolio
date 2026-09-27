import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankConnection, BankTransaction } from '@/types';

const mocks = vi.hoisted(() => ({
  getAccountById: vi.fn(),
  getAccountProjectionData: vi.fn(),
  getLatestSnapshot: vi.fn(),
  getBankConnections: vi.fn(),
  getBankTransactions: vi.fn(),
}));

vi.mock('@/lib/db/cached', () => ({
  cachedGetAccountById: mocks.getAccountById,
  cachedGetAccountProjectionData: mocks.getAccountProjectionData,
  cachedGetLatestSnapshot: mocks.getLatestSnapshot,
  cachedGetBankConnections: mocks.getBankConnections,
  cachedGetBankTransactions: mocks.getBankTransactions,
  cachedGetMortgagesForUser: vi.fn(async () => []),
  cachedGetMortgageProjectionData: vi.fn(async () => null),
  cachedGetBudgets: vi.fn(async () => []),
  cachedGetGoals: vi.fn(async () => []),
  cachedGetTrips: vi.fn(async () => []),
}));

import {
  gatherProjectionInputs,
  computeCardBillTransfersForAccount,
  getLinkedCashBankTransactions,
  getCardPaymentSourcesForAccount,
  shouldActualizeAnchorMonth,
  taggedSpendForMonth,
} from './projection-inputs';
import { calculateProjection, resolveAnchor } from './projection';
import { calculateRetrospective } from './retrospective';
import {
  createMockAccount,
  createMockPlannedItem,
  createMockRecurringItem,
  createMockSnapshot,
} from '@/test/mocks';

let n = 0;
function tx(partial: Partial<BankTransaction> & { bookingDate: string; amount: number }): BankTransaction {
  n += 1;
  return {
    id: `tx-${n}`,
    linkedAccountId: 'link-cash',
    dedupKey: `dk-${n}`,
    currency: 'EUR',
    status: 'booked',
    firstSeenAt: '2026-08-01T00:00:00Z',
    lastSeenAt: '2026-08-01T00:00:00Z',
    ...partial,
  };
}

const account = createMockAccount({ id: 'acc', startingDate: '2026-01', startingBalance: 0, planningHorizonMonths: 12 });
const salary = createMockRecurringItem({ type: 'income', name: 'Salary', amount: 3000, startDate: '2026-01', isFixedAmount: true });
const rent = createMockRecurringItem({ type: 'expense', name: 'Rent', amount: 800, category: 'Housing', startDate: '2026-01', isFixedAmount: true });

const connection = {
  id: 'conn-1',
  aspspName: 'Test Bank',
  linkedAccounts: [
    { id: 'link-cash', accountRole: 'cash', linkedFinancialAccountId: 'acc', isExcluded: false, name: 'Current' },
    { id: 'link-card', accountRole: 'credit-card', linkedFinancialAccountId: 'acc', isExcluded: false, name: 'Visa' },
  ],
} as unknown as BankConnection;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 27, 12, 0, 0)); // 27 Sep 2026, local
  vi.clearAllMocks();
  mocks.getAccountById.mockResolvedValue(account);
  mocks.getAccountProjectionData.mockResolvedValue({
    recurringItems: [salary, rent],
    plannedItems: [],
    salaryConfigs: [],
    taxedIncomes: [],
  });
  mocks.getBankConnections.mockResolvedValue([connection]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shouldActualizeAnchorMonth', () => {
  it('actualizes the current month regardless of the anchor source', () => {
    expect(shouldActualizeAnchorMonth('2026-09', null, '2026-09')).toBe(true);
    expect(shouldActualizeAnchorMonth('2026-09', '2026-09-10', '2026-09')).toBe(true);
  });

  it('actualizes an earlier month only for a live bank-sync anchor', () => {
    expect(shouldActualizeAnchorMonth('2026-08', '2026-08-20', '2026-09')).toBe(true);
    expect(shouldActualizeAnchorMonth('2026-08', null, '2026-09')).toBe(false);
  });
});

describe('stale bank-sync anchor (sync stopped last month)', () => {
  it("actualizes the anchor month with every booking of the month instead of re-adding the month's full forecast", async () => {
    // Last successful balance read Aug 20: €1,200 live, rent already paid.
    mocks.getLatestSnapshot.mockResolvedValue(
      createMockSnapshot({
        entityId: 'acc',
        yearMonth: '2026-08',
        actualBalance: 1200,
        source: 'bank-sync',
        createdAt: '2026-08-20T11:00:00.000Z',
      })
    );
    mocks.getBankTransactions.mockImplementation(async (_userId: string, linkId: string) =>
      linkId === 'link-cash'
        ? [
            tx({ bookingDate: '2026-08-03', amount: -800, counterpartyName: 'Rent' }),
            // Written by a later run whose balance read failed — not in the €1,200.
            tx({ bookingDate: '2026-08-25', amount: 3000, counterpartyName: 'Salary' }),
          ]
        : []
    );

    const inputs = await gatherProjectionInputs('user-alex', 'acc');
    expect(inputs).not.toBeNull();
    expect(inputs!.anchorLiveAsOf).toBe('2026-08-20');
    // Legacy snapshot: O = €1,200 live − the €800 rent booked through Aug 20.
    expect(inputs!.anchorMonthStartBalance).toBe(2000);
    // Every booked row of August — the later salary too (it is applied, not lost).
    expect(inputs!.currentMonthActuals?.openingBalance).toBe(2000);
    expect(inputs!.currentMonthActuals?.transactions.map((t) => t.amount)).toEqual([-800, 3000]);

    const monthly = calculateProjection(
      inputs!.account,
      inputs!.directRecurring,
      inputs!.directPlanned,
      inputs!.taxedIncomes,
      undefined,
      inputs!.latestSnapshot,
      [],
      [],
      [],
      inputs!.currentMonthActuals
    );
    const aug = monthly.find((m) => m.yearMonth === '2026-08')!;
    const sep = monthly.find((m) => m.yearMonth === '2026-09')!;
    expect(aug.isActualized).toBe(true);
    // O €2,000 + rent −€800 + salary €3,000 (both matched ⇒ nothing outstanding).
    expect(aug.startingBalance).toBe(4200);
    expect(aug.openingBalance).toBe(2000);
    expect(aug.endingBalance).toBe(4200);
    expect(sep.startingBalance).toBe(4200);
  });

  it('keeps actualizing a past manual anchor month that has booked rows (opening + bookings)', async () => {
    mocks.getLatestSnapshot.mockResolvedValue(
      createMockSnapshot({ entityId: 'acc', yearMonth: '2026-08', actualBalance: 1200, source: 'manual' })
    );
    mocks.getBankTransactions.mockResolvedValue([tx({ bookingDate: '2026-08-03', amount: -800 })]);
    const inputs = await gatherProjectionInputs('user-alex', 'acc');
    expect(inputs!.anchorLiveAsOf).toBeNull();
    expect(inputs!.currentMonthActuals?.openingBalance).toBe(1200);
    expect(inputs!.currentMonthActuals?.transactions).toHaveLength(1);
  });

  it('forecasts a past manual anchor month in full when it has no booked rows', async () => {
    mocks.getLatestSnapshot.mockResolvedValue(
      createMockSnapshot({ entityId: 'acc', yearMonth: '2026-08', actualBalance: 1200, source: 'manual' })
    );
    mocks.getBankTransactions.mockResolvedValue([tx({ bookingDate: '2026-09-03', amount: -800 })]);
    const inputs = await gatherProjectionInputs('user-alex', 'acc');
    expect(inputs!.currentMonthActuals).toBeNull();
  });
});

describe('bank-sync anchor with stored provenance (R2-1/R2-2)', () => {
  it('re-bases an ITAV snapshot on its booked-basis balance so pending holds are not counted twice', async () => {
    mocks.getLatestSnapshot.mockResolvedValue(
      createMockSnapshot({
        entityId: 'acc',
        yearMonth: '2026-09',
        actualBalance: 1150, // ITAV: booked €1,200 − €50 hold
        source: 'bank-sync',
        createdAt: '2026-09-10T11:00:00.000Z',
        balanceType: 'ITAV',
        balanceAsOf: '2026-09-10',
        monthStartBalance: 2000,
      })
    );
    mocks.getBankTransactions.mockImplementation(async (_userId: string, linkId: string) =>
      linkId === 'link-cash'
        ? [
            tx({ bookingDate: '2026-09-03', amount: -800, counterpartyName: 'Rent' }),
            tx({ bookingDate: '2026-09-09', amount: -50, status: 'pending', counterpartyName: 'Hold' }),
          ]
        : []
    );
    const inputs = await gatherProjectionInputs('user-alex', 'acc');
    expect(inputs!.anchorLiveAsOf).toBe('2026-09-10');
    expect(inputs!.anchorMonthStartBalance).toBe(2000);
    // The stored snapshot is passed through; the engine starts from O + booked rows.
    expect(inputs!.latestSnapshot?.actualBalance).toBe(1150);
    expect(inputs!.currentMonthActuals).toEqual({
      openingBalance: 2000,
      transactions: [expect.objectContaining({ amount: -800 })],
    });
    const sep = calculateProjection(
      inputs!.account, inputs!.directRecurring, inputs!.directPlanned, inputs!.taxedIncomes,
      undefined, inputs!.latestSnapshot, [], [], [], inputs!.currentMonthActuals
    ).find((m) => m.yearMonth === '2026-09')!;
    expect(sep.startingBalance).toBe(1200); // booked basis: the €50 hold is not counted
    expect(sep.endingBalance).toBe(4200); // + outstanding salary
  });

  it('a CLBD for the previous month-end anchors the full current month from that close', async () => {
    mocks.getLatestSnapshot.mockResolvedValue(
      createMockSnapshot({
        entityId: 'acc',
        yearMonth: '2026-09',
        actualBalance: 1000,
        source: 'bank-sync',
        createdAt: '2026-09-01T06:00:00.000Z',
        balanceType: 'CLBD',
        balanceAsOf: '2026-08-31',
        monthStartBalance: 1000,
      })
    );
    mocks.getBankTransactions.mockImplementation(async (_userId: string, linkId: string) =>
      linkId === 'link-cash' ? [tx({ bookingDate: '2026-09-01', amount: -800, counterpartyName: 'Rent' })] : []
    );
    const inputs = await gatherProjectionInputs('user-alex', 'acc');
    expect(inputs!.anchorLiveAsOf).toBe('2026-08-31');
    // The Sep 1 rent is after the balance's as-of date but still a booked row
    // of September: it is applied on top of O and its forecast line is paid.
    expect(inputs!.currentMonthActuals?.openingBalance).toBe(1000);
    expect(inputs!.currentMonthActuals?.transactions.map((t) => t.amount)).toEqual([-800]);
    const sep = calculateProjection(
      inputs!.account, inputs!.directRecurring, inputs!.directPlanned, inputs!.taxedIncomes,
      undefined, inputs!.latestSnapshot, [], [], [], inputs!.currentMonthActuals
    ).find((m) => m.yearMonth === '2026-09')!;
    expect(sep.startingBalance).toBe(200);
    expect(sep.endingBalance).toBe(3200); // 1000 − 800 + outstanding salary 3000
  });

  it('a legacy bank-sync snapshot reconstructs O through its createdAt date, then follows the same rule', async () => {
    const legacy = createMockSnapshot({
      entityId: 'acc',
      yearMonth: '2026-09',
      actualBalance: 1000,
      source: 'bank-sync',
      createdAt: '2026-09-10T11:00:00.000Z',
    });
    mocks.getLatestSnapshot.mockResolvedValue(legacy);
    mocks.getBankTransactions.mockImplementation(async (_userId: string, linkId: string) =>
      linkId === 'link-cash'
        ? [
            tx({ bookingDate: '2026-09-03', amount: -800, counterpartyName: 'Rent' }),
            tx({ bookingDate: '2026-09-15', amount: -60, counterpartyName: 'Kiosk' }), // after Sep 10
          ]
        : []
    );
    const inputs = await gatherProjectionInputs('user-alex', 'acc');
    expect(inputs!.latestSnapshot).toBe(legacy);
    expect(inputs!.anchorLiveAsOf).toBe('2026-09-10');
    expect(inputs!.anchorMonthStartBalance).toBe(1800); // 1000 − (−800)
    const sep = calculateProjection(
      inputs!.account, inputs!.directRecurring, inputs!.directPlanned, inputs!.taxedIncomes,
      undefined, inputs!.latestSnapshot, [], [], [], inputs!.currentMonthActuals
    ).find((m) => m.yearMonth === '2026-09')!;
    expect(sep.startingBalance).toBe(940); // 1800 − 800 − 60
    expect(sep.endingBalance).toBe(3940); // + outstanding salary
  });
});

describe('R5-1: bookings after the balance cutoff (gathered inputs)', () => {
  it('an Oct 1 CLBD €1,000 for Sep 30 plus an unplanned Oct 1 debit €100 ends October at €900', async () => {
    vi.setSystemTime(new Date(2026, 9, 1, 9, 0, 0)); // 1 Oct 2026, local
    mocks.getAccountProjectionData.mockResolvedValue({
      recurringItems: [],
      plannedItems: [],
      salaryConfigs: [],
      taxedIncomes: [],
    });
    mocks.getLatestSnapshot.mockResolvedValue(
      createMockSnapshot({
        entityId: 'acc',
        yearMonth: '2026-10',
        actualBalance: 1000,
        source: 'bank-sync',
        createdAt: '2026-10-01T06:00:00.000Z',
        balanceType: 'CLBD',
        balanceAsOf: '2026-09-30',
        monthStartBalance: 1000,
      })
    );
    mocks.getBankTransactions.mockImplementation(async (_userId: string, linkId: string) =>
      linkId === 'link-cash' ? [tx({ bookingDate: '2026-10-01', amount: -100, counterpartyName: 'Kiosk' })] : []
    );
    const inputs = await gatherProjectionInputs('user-alex', 'acc');
    const oct = calculateProjection(
      inputs!.account, inputs!.directRecurring, inputs!.directPlanned, inputs!.taxedIncomes,
      undefined, inputs!.latestSnapshot, [], [], [], inputs!.currentMonthActuals
    ).find((m) => m.yearMonth === '2026-10')!;
    expect(oct.isActualized).toBe(true);
    expect(oct.openingBalance).toBe(1000);
    expect(oct.endingBalance).toBe(900); // was €1,000: the debit disappeared
  });
});

describe('R5-4: a manual current-month opening is advanced by the booked rows it actualizes', () => {
  const rentOnly = createMockRecurringItem({ type: 'expense', name: 'Rent', amount: 100, category: 'Housing', startDate: '2026-01', isFixedAmount: true });

  beforeEach(() => {
    mocks.getAccountProjectionData.mockResolvedValue({
      recurringItems: [rentOnly],
      plannedItems: [],
      salaryConfigs: [],
      taxedIncomes: [],
    });
    mocks.getLatestSnapshot.mockResolvedValue(
      createMockSnapshot({ entityId: 'acc', yearMonth: '2026-09', actualBalance: 1000, source: 'manual' })
    );
    mocks.getBankTransactions.mockImplementation(async (_userId: string, linkId: string) =>
      linkId === 'link-cash' ? [tx({ bookingDate: '2026-09-03', amount: -100, counterpartyName: 'Rent' })] : []
    );
  });

  async function project() {
    const inputs = await gatherProjectionInputs('user-alex', 'acc');
    return {
      inputs: inputs!,
      rows: calculateProjection(
        inputs!.account, inputs!.directRecurring, inputs!.directPlanned, inputs!.taxedIncomes,
        undefined, inputs!.latestSnapshot, [], [], [], inputs!.currentMonthActuals
      ),
    };
  }

  it('manual Sep opening €1,000 + booked rent −€100 matching the planned rent ends September at €900', async () => {
    const { inputs, rows } = await project();
    expect(inputs.anchorLiveAsOf).toBeNull();
    expect(inputs.anchorMonthStartBalance).toBe(1000);
    const sep = rows.find((m) => m.yearMonth === '2026-09')!;
    expect(sep.isActualized).toBe(true);
    expect(sep.startingBalance).toBe(900);
    expect(sep.openingBalance).toBe(1000);
    expect(sep.expenseBreakdown[0].isPaid).toBe(true);
    expect(sep.endingBalance).toBe(900); // was €1,000 (rent marked paid but never subtracted)
  });

  it('the retrospective closes August at the same opening the forecast starts September from', async () => {
    mocks.getBankTransactions.mockImplementation(async (_userId: string, linkId: string) =>
      linkId === 'link-cash'
        ? [
            tx({ bookingDate: '2026-08-20', amount: -50, counterpartyName: 'Kiosk' }),
            tx({ bookingDate: '2026-09-03', amount: -100, counterpartyName: 'Rent' }),
          ]
        : []
    );
    const { inputs, rows } = await project();
    const sep = rows.find((m) => m.yearMonth === '2026-09')!;
    const [aug] = calculateRetrospective({
      accountId: 'acc',
      transactions: await getLinkedCashBankTransactions('user-alex', 'acc'),
      anchor: resolveAnchor(inputs.account.startingDate, inputs.account.startingBalance, inputs.latestSnapshot),
      anchorLiveAsOf: inputs.anchorLiveAsOf,
      anchorMonthStartBalance: inputs.anchorMonthStartBalance,
    });
    expect(aug.yearMonth).toBe('2026-08');
    expect(aug.endingBalance).toBe(1000);
    expect(aug.endingBalance).toBe(sep.openingBalance);
  });

  it('no jump after the month rolls over: September still ends at €900', async () => {
    const before = (await project()).rows;
    vi.setSystemTime(new Date(2026, 9, 2, 12, 0, 0)); // 2 Oct 2026, local
    const { inputs, rows: after } = await project();
    // The past manual month keeps its booked rows (opening + bookings).
    expect(inputs.currentMonthActuals?.openingBalance).toBe(1000);
    const sepBefore = before.find((m) => m.yearMonth === '2026-09')!;
    const sepAfter = after.find((m) => m.yearMonth === '2026-09')!;
    expect(sepAfter.isActualized).toBe(true);
    expect(sepAfter.endingBalance).toBe(sepBefore.endingBalance);
    expect(after.find((m) => m.yearMonth === '2026-10')!.startingBalance).toBe(900);
  });

  it('R6-3: an unplanned booking survives the rollover (no fictitious €50)', async () => {
    mocks.getBankTransactions.mockImplementation(async (_userId: string, linkId: string) =>
      linkId === 'link-cash'
        ? [
            tx({ bookingDate: '2026-09-03', amount: -100, counterpartyName: 'Rent' }),
            tx({ bookingDate: '2026-09-12', amount: -50, counterpartyName: 'Kiosk' }),
          ]
        : []
    );
    const sepBefore = (await project()).rows.find((m) => m.yearMonth === '2026-09')!;
    expect(sepBefore.endingBalance).toBe(850);
    vi.setSystemTime(new Date(2026, 9, 1, 9, 0, 0)); // 1 Oct 2026, local
    const after = (await project()).rows;
    expect(after.find((m) => m.yearMonth === '2026-09')!.endingBalance).toBe(850);
    expect(after.find((m) => m.yearMonth === '2026-10')!.startingBalance).toBe(850);
  });
});

describe('computeCardBillTransfersForAccount horizon', () => {
  it('stops forecast bills at the optional end month', async () => {
    const cardConnection = {
      id: 'conn-1',
      aspspName: 'Test Bank',
      linkedAccounts: [
        {
          id: 'link-card', accountRole: 'credit-card', linkedFinancialAccountId: 'acc', isExcluded: false,
          name: 'Visa', statementDay: 20, paymentDueDay: 10, expectedMonthlySpend: 100,
        },
      ],
    } as unknown as BankConnection;
    mocks.getBankConnections.mockResolvedValue([cardConnection]);
    mocks.getBankTransactions.mockResolvedValue([]);
    const full = await computeCardBillTransfersForAccount('user-alex', 'acc', account, [], []);
    const capped = await computeCardBillTransfersForAccount('user-alex', 'acc', account, [], [], undefined, '2026-10');
    const forecasts = (list: typeof full) => list.filter((t) => t.basis === 'forecast');
    // Sept 27, statement day 20 / due day 10: the open cycle is billed Nov 10.
    expect(forecasts(full).length).toBeGreaterThan(6);
    expect(forecasts(capped)).toEqual([]);
    // The real (open-cycle) bill is kept either way.
    expect(capped.filter((t) => t.basis !== 'forecast')).toEqual(full.filter((t) => t.basis !== 'forecast'));
    const cappedDec = await computeCardBillTransfersForAccount('user-alex', 'acc', account, [], [], undefined, '2026-12');
    expect(forecasts(cappedDec).map((t) => t.yearMonth)).toEqual(['2026-12']);
  });
});

describe('bank data loader (PERF-06)', () => {
  it('reads the connection list and each linked ledger once per projection', async () => {
    mocks.getLatestSnapshot.mockResolvedValue(
      createMockSnapshot({
        entityId: 'acc',
        yearMonth: '2026-09',
        actualBalance: 1000,
        source: 'bank-sync',
        createdAt: '2026-09-27T09:00:00.000Z',
      })
    );
    mocks.getBankTransactions.mockResolvedValue([tx({ bookingDate: '2026-09-02', amount: -50 })]);

    const inputs = await gatherProjectionInputs('user-alex', 'acc');
    await Promise.all([
      computeCardBillTransfersForAccount('user-alex', 'acc', account, [salary, rent], [], inputs!.bankData),
      getLinkedCashBankTransactions('user-alex', 'acc', inputs!.bankData),
      getCardPaymentSourcesForAccount('user-alex', 'acc', inputs!.bankData),
    ]);

    expect(mocks.getBankConnections).toHaveBeenCalledTimes(1);
    const ledgerCalls = mocks.getBankTransactions.mock.calls.map((c) => c[1]).sort();
    expect(ledgerCalls).toEqual(['link-card', 'link-cash']);
  });
});

describe('taggedSpendForMonth (card forecast bill)', () => {
  const netflix = createMockRecurringItem({
    id: 'rec-netflix',
    type: 'expense',
    name: 'Netflix',
    amount: 15.99,
    category: 'Subscriptions',
    startDate: '2026-01',
    paidByCardLinkId: 'card-1',
  });
  const overrides = [
    createMockPlannedItem({
      kind: 'one-off',
      name: 'Netflix',
      amount: 15.99,
      scheduledDate: '2026-03',
      isRecurringOverride: true,
      linkedRecurringItemId: 'rec-netflix',
      skipOccurrence: true,
    }),
    createMockPlannedItem({
      kind: 'one-off',
      name: 'Netflix',
      amount: 22.99,
      scheduledDate: '2026-04',
      isRecurringOverride: true,
      linkedRecurringItemId: 'rec-netflix',
    }),
  ];

  it('drops a skipped occurrence and uses an overridden amount', () => {
    expect(taggedSpendForMonth([netflix], overrides, '2026-03', 'card-1')).toBe(0);
    expect(taggedSpendForMonth([netflix], overrides, '2026-04', 'card-1')).toBeCloseTo(22.99, 2);
    expect(taggedSpendForMonth([netflix], overrides, '2026-05', 'card-1')).toBeCloseTo(15.99, 2);
  });

  it('never counts an override row as extra spend, even if it carries the card tag', () => {
    const tagged = overrides.map((o) => ({ ...o, paidByCardLinkId: 'card-1' }));
    expect(taggedSpendForMonth([netflix], tagged, '2026-04', 'card-1')).toBeCloseTo(22.99, 2);
  });
});
