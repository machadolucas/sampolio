import { describe, it, expect } from 'vitest';
import {
  expectedCashBalance,
  expectedInvestmentBalance,
  expectedReceivableBalance,
  expectedDebtState,
} from './reconcile-prefill';
import {
  calculateInvestmentProjection,
  calculateReceivableProjection,
  calculateDebtAmortization,
} from './wealth-projection';
import {
  createMockInvestment,
  createMockContribution,
  createMockReceivable,
  createMockRepayment,
  createMockDebt,
  createMockSnapshot,
  createMockAccount,
  createMockRecurringItem,
} from '@/test/mocks';
import { calculateProjection } from './projection';
import { anchorMonthActuals, anchorMonthOpeningBalance } from './live-anchor';
import type { BalanceSnapshot, BankTransaction } from '@/types';

// The invariant under test: confirming a prefilled (untouched) check-in row
// writes a snapshot at month M with the prefilled value, and re-anchoring on
// that snapshot must leave the projection for M onwards unchanged.

describe('expectedInvestmentBalance', () => {
  const inv = createMockInvestment({ startingValuation: 10000, valuationDate: '2025-01', annualGrowthRate: 7, currentValuation: 10000 });
  const contribs = [createMockContribution({ investmentAccountId: inv.id, amount: 500, startDate: '2025-01' })];

  it('prefills the projected start-of-month valuation, not the stale stored one', () => {
    const expected = expectedInvestmentBalance(inv, contribs, null, '2026-09');
    // 20 months of 7% growth + €500/month is well above the stored €10,000.
    expect(expected).toBeGreaterThan(20000);
    const rows = calculateInvestmentProjection(inv, contribs, '2026-08', '2026-08', null);
    expect(expected).toBeCloseTo(rows[0].endingValuation, 6);
  });

  it('confirming the prefill as a snapshot leaves the projection unchanged', () => {
    const before = calculateInvestmentProjection(inv, contribs, '2026-09', '2027-09', null);
    const snap = createMockSnapshot({
      entityType: 'investment', entityId: inv.id, yearMonth: '2026-09',
      actualBalance: expectedInvestmentBalance(inv, contribs, null, '2026-09'),
    });
    const after = calculateInvestmentProjection(inv, contribs, '2026-09', '2027-09', snap);
    expect(after.map(r => r.endingValuation)).toEqual(before.map(r => r.endingValuation));
  });

  it('anchors on the latest snapshot', () => {
    const snap = createMockSnapshot({ entityType: 'investment', entityId: inv.id, yearMonth: '2026-09', actualBalance: 30000 });
    expect(expectedInvestmentBalance(inv, contribs, snap, '2026-09')).toBe(30000);
  });

  it('falls back to the stored value for a month before the anchor', () => {
    const snap = createMockSnapshot({ entityType: 'investment', entityId: inv.id, yearMonth: '2026-09', actualBalance: 30000 });
    expect(expectedInvestmentBalance({ ...inv, currentValuation: 0 }, contribs, snap, '2026-06')).toBe(0);
  });
});

describe('expectedReceivableBalance', () => {
  const rec = createMockReceivable({ initialPrincipal: 5000, currentBalance: 5000, startDate: '2026-01', expectedMonthlyRepayment: 250 });
  const repayments = [createMockRepayment({ receivableId: rec.id, date: '2026-02', amount: 1000 })];

  it('subtracts actual repayments made before the month', () => {
    expect(expectedReceivableBalance(rec, repayments, null, '2026-04')).toBe(4000);
  });

  it('keeps the expected repayments of the months between now and a future check-in month', () => {
    // Overview projects from the current month: Sep repays the expected 100, so
    // October starts at 900. The prefill must agree (not restart repayments in Oct).
    const r = createMockReceivable({ initialPrincipal: 1000, currentBalance: 1000, startDate: '2026-09', expectedMonthlyRepayment: 100 });
    const overview = calculateReceivableProjection(r, [], '2026-09', '2026-10', null);
    expect(overview.find((row) => row.yearMonth === '2026-10')?.startingBalance).toBe(900);
    expect(expectedReceivableBalance(r, [], null, '2026-10', '2026-09')).toBe(900);
  });

  it('confirming the prefill as a snapshot leaves the projection unchanged', () => {
    const before = calculateReceivableProjection(rec, repayments, '2026-04', '2027-04', null);
    const snap = createMockSnapshot({
      entityType: 'receivable', entityId: rec.id, yearMonth: '2026-04',
      actualBalance: expectedReceivableBalance(rec, repayments, null, '2026-04'),
    });
    const after = calculateReceivableProjection(rec, repayments, '2026-04', '2027-04', snap);
    expect(after.map(r => r.endingBalance)).toEqual(before.map(r => r.endingBalance));
  });

  it('is 0 once fully repaid', () => {
    const paid = [createMockRepayment({ receivableId: rec.id, date: '2026-02', amount: 5000 })];
    expect(expectedReceivableBalance(rec, paid, null, '2026-06')).toBe(0);
  });
});

describe('expectedDebtState', () => {
  it('prefills the amortized start-of-month principal, not initialPrincipal', () => {
    const debt = createMockDebt({ initialPrincipal: 20000, startDate: '2024-01', fixedInterestRate: 3, monthlyPayment: 400 });
    const state = expectedDebtState(debt, [], [], null, '2026-09');
    expect(state.principal).toBeLessThan(15000);
    expect(state.principal).toBeGreaterThan(0);
    expect(state.remainingInstallments).toBeUndefined();
  });

  it('confirming the prefill as a snapshot leaves the amortization unchanged', () => {
    const debt = createMockDebt({ initialPrincipal: 20000, startDate: '2024-01', fixedInterestRate: 3, monthlyPayment: 400 });
    const before = calculateDebtAmortization(debt, [], [], '2026-09', '2028-09', null);
    const state = expectedDebtState(debt, [], [], null, '2026-09');
    const snap = createMockSnapshot({ entityType: 'debt', entityId: debt.id, yearMonth: '2026-09', actualBalance: -state.principal });
    // applyReconciliationBalances also rewrites initialPrincipal on check-in.
    const after = calculateDebtAmortization({ ...debt, initialPrincipal: state.principal }, [], [], '2026-09', '2028-09', snap);
    expect(after.map(r => r.endingPrincipal)).toEqual(before.map(r => r.endingPrincipal));
  });

  it('tracks remaining installments so a confirmed fixed-installment debt keeps its payoff', () => {
    const debt = createMockDebt({
      debtType: 'fixed-installment', interestModelType: 'none', initialPrincipal: 1200,
      installmentAmount: 100, totalInstallments: 12, startDate: '2026-01', monthlyPayment: undefined,
    });
    const state = expectedDebtState(debt, [], [], null, '2026-04');
    expect(state).toEqual({ principal: 900, remainingInstallments: 9 });

    const before = calculateDebtAmortization(debt, [], [], '2026-04', '2027-06', null);
    const snap = createMockSnapshot({ entityType: 'debt', entityId: debt.id, yearMonth: '2026-04', actualBalance: -state.principal });
    const confirmed = { ...debt, initialPrincipal: state.principal, remainingInstallments: state.remainingInstallments };
    const after = calculateDebtAmortization(confirmed, [], [], '2026-04', '2027-06', snap);
    expect(after.map(r => r.endingPrincipal)).toEqual(before.map(r => r.endingPrincipal));
  });

  it('is 0 once paid off', () => {
    const debt = createMockDebt({ initialPrincipal: 1000, startDate: '2026-01', fixedInterestRate: 0, monthlyPayment: 500 });
    expect(expectedDebtState(debt, [], [], null, '2026-06').principal).toBe(0);
  });
});

describe('expectedCashBalance (actualized month)', () => {
  const account = createMockAccount({ id: 'acc', startingDate: '2026-01', startingBalance: 0, planningHorizonMonths: 6 });
  const rent = createMockRecurringItem({ type: 'expense', name: 'Rent', amount: 100, category: 'Housing', startDate: '2026-01', isFixedAmount: true });
  const salary = createMockRecurringItem({ type: 'income', name: 'Salary', amount: 2000, startDate: '2026-01', isFixedAmount: true });
  const ledger: BankTransaction[] = [
    {
      id: 'tx-rent', linkedAccountId: 'link-1', dedupKey: 'dk-rent', currency: 'EUR', status: 'booked',
      bookingDate: '2026-09-03', amount: -100, counterpartyName: 'Rent',
      firstSeenAt: '2026-09-03T00:00:00Z', lastSeenAt: '2026-09-03T00:00:00Z',
    },
  ];
  const project = (snapshot: BalanceSnapshot) =>
    calculateProjection(account, [rent, salary], [], [], undefined, snapshot, [], [], [],
      anchorMonthActuals('2026-09', anchorMonthOpeningBalance('2026-01', 0, snapshot, ledger), ledger));

  it("prefills the month-start opening, not the live booked balance, and confirming it changes nothing", () => {
    // Bank-sync snapshot: live €900 after the rent, opening €1,000.
    const synced = createMockSnapshot({
      entityId: 'acc', yearMonth: '2026-09', actualBalance: 900, source: 'bank-sync',
      createdAt: '2026-09-10T11:00:00.000Z', balanceType: 'ITBD', balanceAsOf: '2026-09-10', monthStartBalance: 1000,
    });
    const before = project(synced);
    expect(before[0].startingBalance).toBe(900);
    const prefill = expectedCashBalance(before, '2026-09');
    expect(prefill).toBe(1000); // startingBalance €900 would double count the rent

    // Confirming the untouched row writes a manual start-of-month snapshot.
    const confirmed = createMockSnapshot({ entityId: 'acc', yearMonth: '2026-09', actualBalance: prefill!, source: 'manual' });
    const after = project(confirmed);
    expect(after.map((m) => m.endingBalance)).toEqual(before.map((m) => m.endingBalance));
  });

  it('uses startingBalance for a forecast month and null when there is no row', () => {
    const rows = project(createMockSnapshot({ entityId: 'acc', yearMonth: '2026-09', actualBalance: 1000, source: 'manual' }));
    expect(expectedCashBalance(rows, '2026-10')).toBe(rows[1].startingBalance);
    expect(expectedCashBalance(rows, '2027-09')).toBeNull();
  });
});
