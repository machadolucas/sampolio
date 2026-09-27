import { describe, it, expect } from 'vitest';
import {
  assembleWealthProjection,
  buildWealthProjectionData,
  currentCashBalances,
  pickBudgetBanner,
  summarizeCardCredit,
  type WealthInputs,
} from './wealth-assembly';
import { snapshotEntityKey } from './latest-snapshots';
import {
  createMockAccount,
  createMockBudget,
  createMockBudgetExpenseEntry,
  createMockBudgetLine,
  createMockDebt,
  createMockInvestment,
  createMockMortgageRate,
  createMockSharedMortgage,
  createMockSnapshot,
} from '@/test/mocks';
import type { MonthlyProjection } from '@/types';

function emptyInputs(overrides: Partial<WealthInputs> = {}): WealthInputs {
  return {
    accounts: [],
    investments: [],
    receivables: [],
    debts: [],
    contributions: {},
    repayments: {},
    referenceRates: {},
    extraPayments: {},
    latestSnapshots: {},
    cashProjections: {},
    mortgages: [],
    cardLiabilities: [],
    splitNetCents: 0,
    ...overrides,
  };
}

function row(yearMonth: string, endingBalance: number): MonthlyProjection {
  const [year, month] = yearMonth.split('-').map(Number);
  return {
    yearMonth, year, month,
    startingBalance: endingBalance, totalIncome: 0, totalExpenses: 0, netChange: 0, endingBalance,
    incomeBreakdown: [], expenseBreakdown: [],
  };
}

describe('buildWealthProjectionData', () => {
  it('turns keyed records into the engine maps and picks each entity snapshot by type', () => {
    const inv = createMockInvestment({ id: 'inv-1' });
    const debt = createMockDebt({ id: 'debt-1' });
    const invSnap = createMockSnapshot({ entityType: 'investment', entityId: 'inv-1', actualBalance: 42 });
    const data = buildWealthProjectionData(
      emptyInputs({
        investments: [inv],
        debts: [debt],
        contributions: { 'inv-1': [] },
        referenceRates: { 'debt-1': [] },
        extraPayments: { 'debt-1': [] },
        latestSnapshots: { [snapshotEntityKey('investment', 'inv-1')]: invSnap },
        splitNetCents: -1250,
      }),
      'alex'
    );
    expect(data.investmentSnapshots?.get('inv-1')).toBe(invSnap);
    expect(data.debtSnapshots?.get('debt-1')).toBeNull();
    expect(data.investmentContributions.get('inv-1')).toEqual([]);
    expect(data.splitNetTotal).toBe(-12.5);
    expect(data.currentUserId).toBe('alex');
  });
});

describe('assembleWealthProjection', () => {
  it('starts at the given month and uses the cash projections', () => {
    const account = createMockAccount({ id: 'acc', startingDate: '2026-09', planningHorizonMonths: 3 });
    const result = assembleWealthProjection(
      emptyInputs({
        accounts: [account],
        cashProjections: { acc: { monthly: [row('2026-09', 1200), row('2026-10', 1300)], retrospective: [] } },
      }),
      'alex',
      '2026-09',
      2,
      new Date(2026, 8, 15)
    );
    expect(result.startDate).toBe('2026-09');
    expect(result.months[0].yearMonth).toBe('2026-09');
    expect(result.months[0].cashAccountsTotal).toBe(1200);
    expect(result.months[1].cashAccountsTotal).toBe(1300);
    expect(result.mortgageSlice).toBeNull();
    expect(result.euriborDue).toBeNull();
  });

  it('folds a shared mortgage in and reports the member slice for the start month', () => {
    const mortgage = createMockSharedMortgage();
    const rates = [createMockMortgageRate()];
    const result = assembleWealthProjection(
      emptyInputs({
        mortgages: [{ name: 'Home', inputs: { mortgage, rates, costs: [], extraPayments: [], snapshots: [], actuals: [] } }],
      }),
      'alex',
      '2026-09',
      12,
      new Date(2026, 8, 15)
    );
    expect(result.mortgageSlice).not.toBeNull();
    expect(result.mortgageSlice!.stake).toBeGreaterThan(0);
    // Equity is net of Alex's loan share.
    expect(result.mortgageSlice!.equity).toBeCloseTo(result.mortgageSlice!.stake - result.mortgageSlice!.liability, 6);
    expect(result.months[0].netWorth).toBeCloseTo(result.mortgageSlice!.equity, 6);
  });

  it('has no member slice for a viewer who is not a member', () => {
    const mortgage = createMockSharedMortgage();
    const result = assembleWealthProjection(
      emptyInputs({
        mortgages: [{ name: 'Home', inputs: { mortgage, rates: [createMockMortgageRate()], costs: [], extraPayments: [], snapshots: [], actuals: [] } }],
      }),
      'someone-else',
      '2026-09',
      12,
      new Date(2026, 8, 15)
    );
    expect(result.mortgageSlice).toEqual({ equity: 0, liability: 0, stake: 0 });
  });
});

describe('currentCashBalances', () => {
  it('uses the latest cash snapshot when present, else the starting balance', () => {
    const synced = createMockAccount({ id: 'synced', startingBalance: 100 });
    const manual = createMockAccount({ id: 'manual', startingBalance: 250 });
    const map = currentCashBalances(emptyInputs({
      accounts: [synced, manual],
      latestSnapshots: {
        [snapshotEntityKey('cash-account', 'synced')]: createMockSnapshot({ entityId: 'synced', actualBalance: 0 }),
      },
    }));
    // A real 0 balance wins over the starting value (no truthiness fallback).
    expect(map.get('synced')).toBe(0);
    expect(map.get('manual')).toBe(250);
  });
});

describe('summarizeCardCredit', () => {
  it('totals outstanding and derives available credit only from cards with a limit', () => {
    const summary = summarizeCardCredit([
      { linkId: 'c1', name: 'Card 1', outstanding: 300, creditLimit: 1000, availableCredit: 650 },
      { linkId: 'c2', name: 'Card 2', outstanding: 200, creditLimit: 500 },
      { linkId: 'c3', name: 'Card 3', outstanding: 50 },
    ]);
    expect(summary.outstandingTotal).toBe(550);
    expect(summary.credit).toEqual({ available: 650 + 300, limit: 1500 });
  });

  it('has no credit summary when no card exposes a limit', () => {
    expect(summarizeCardCredit([{ linkId: 'c', name: 'C', outstanding: 10 }]).credit).toBeNull();
    expect(summarizeCardCredit([])).toEqual({ outstandingTotal: 0, credit: null });
  });
});

describe('pickBudgetBanner', () => {
  it('prefers an over-budget category on an active confirmed budget', () => {
    const over = createMockBudget({
      id: 'over',
      currency: 'EUR',
      status: 'confirmed',
      startMonth: '2026-09',
      endMonth: '2026-10',
      lines: [createMockBudgetLine({ category: 'Accommodation', amount: 100, kind: 'one-off' })],
      expenseEntries: [createMockBudgetExpenseEntry({ category: 'Accommodation', amount: 400, date: '2026-09-05' })],
    });
    const upcoming = createMockBudget({ id: 'next', currency: 'EUR', status: 'confirmed', startMonth: '2026-10', endMonth: '2026-10' });
    const banner = pickBudgetBanner([upcoming, over], '2026-09');
    expect(banner?.type).toBe('over-budget');
    expect(banner?.budget.id).toBe('over');
    expect(banner?.category).toBe('Accommodation');
  });

  it('falls back to a confirmed budget starting this or next month; ignores drafts and archived', () => {
    const draft = createMockBudget({ status: 'draft', startMonth: '2026-09', endMonth: '2026-09' });
    const archived = createMockBudget({ status: 'confirmed', isArchived: true, startMonth: '2026-09', endMonth: '2026-09' });
    const next = createMockBudget({ id: 'next', status: 'confirmed', startMonth: '2026-10', endMonth: '2026-11' });
    expect(pickBudgetBanner([draft, archived, next], '2026-09')).toMatchObject({ type: 'upcoming', budget: { id: 'next' } });
    expect(pickBudgetBanner([draft, archived], '2026-09')).toBeNull();
  });
});
