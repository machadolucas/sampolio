import { describe, it, expect } from 'vitest';
import { deriveHeroSummary, isZeroMoney, netWorthChangeVsLastMonth } from './overview-hero';
import type { MonthlyProjection } from '@/types';

function row(yearMonth: string, fields: Partial<MonthlyProjection> = {}): MonthlyProjection {
  const [year, month] = yearMonth.split('-').map(Number);
  return {
    yearMonth,
    year,
    month,
    startingBalance: 0,
    totalIncome: 0,
    totalExpenses: 0,
    netChange: 0,
    endingBalance: 0,
    incomeBreakdown: [],
    expenseBreakdown: [],
    ...fields,
  };
}

describe('deriveHeroSummary', () => {
  it('sums the current-month net across accounts (the Cashflow "Net" figure)', () => {
    const summary = deriveHeroSummary({
      accountIds: ['alex-main', 'alex-savings'],
      cashProjections: {
        'alex-main': { monthly: [row('2026-09', { netChange: 5900, totalIncome: 7000, endingBalance: 12000 }), row('2026-10')] },
        'alex-savings': { monthly: [row('2026-09', { netChange: 100, totalIncome: 100, endingBalance: 3000 })] },
      },
      currentYearMonth: '2026-09',
    });
    expect(summary).toEqual({ netChange: 6000, totalIncome: 7100, endBalance: 15000, trend: null });
  });

  it('describes the whole month for a bank-actualized row, not just what is still to come', () => {
    // €3,000 income and €1,000 expenses already settled, €500 expenses remaining:
    // netChange holds only the remaining −€500; the month's plan is +€1,500.
    const summary = deriveHeroSummary({
      accountIds: ['alex-main'],
      cashProjections: {
        'alex-main': { monthly: [row('2026-09', {
          isActualized: true, totalIncome: 0, totalExpenses: 500, netChange: -500,
          plannedTotalIncome: 3000, plannedTotalExpenses: 1500, endingBalance: 4000,
        })] },
      },
      currentYearMonth: '2026-09',
    });
    expect(summary?.netChange).toBe(1500);
    expect(summary?.totalIncome).toBe(3000);
  });

  it('never reports a zero net just because the wealth projection lacks a previous month', () => {
    // The old hero compared the wealth projection's current vs previous month,
    // which never existed — so it always said "balanced" with a €0 delta.
    const summary = deriveHeroSummary({
      accountIds: ['a'],
      cashProjections: { a: { monthly: [row('2026-09', { netChange: -250, endingBalance: 800 })] } },
      currentYearMonth: '2026-09',
    });
    expect(summary?.netChange).toBe(-250);
    expect(summary?.trend).toBeNull();
  });

  it('prefers the wealth engine cash total for the end balance', () => {
    const summary = deriveHeroSummary({
      accountIds: ['a'],
      cashProjections: { a: { monthly: [row('2026-09', { endingBalance: 800 })] } },
      currentYearMonth: '2026-09',
      wealthCurrentMonth: { cashAccountsTotal: 950 },
    });
    expect(summary?.endBalance).toBe(950);
  });

  it('computes a trend only when every account has a previous-month row (forecast or bank retrospective)', () => {
    const withBoth = deriveHeroSummary({
      accountIds: ['a', 'b'],
      cashProjections: {
        a: { monthly: [row('2026-08', { endingBalance: 1000 }), row('2026-09', { endingBalance: 1500 })] },
        b: { monthly: [row('2026-09', { endingBalance: 400 })], retrospective: [row('2026-08', { endingBalance: 300 })] },
      },
      currentYearMonth: '2026-09',
    });
    expect(withBoth?.trend).toBe(600);

    const missingOne = deriveHeroSummary({
      accountIds: ['a', 'b'],
      cashProjections: {
        a: { monthly: [row('2026-08', { endingBalance: 1000 }), row('2026-09', { endingBalance: 1500 })] },
        b: { monthly: [row('2026-09', { endingBalance: 400 })] },
      },
      currentYearMonth: '2026-09',
    });
    expect(missingOne?.trend).toBeNull();
  });

  it('handles the January → December previous-month boundary', () => {
    const summary = deriveHeroSummary({
      accountIds: ['a'],
      cashProjections: { a: { monthly: [row('2026-01', { endingBalance: 50 })], retrospective: [row('2025-12', { endingBalance: 80 })] } },
      currentYearMonth: '2026-01',
    });
    expect(summary?.trend).toBe(-30);
  });

  it('returns null when no account has a current-month row', () => {
    expect(deriveHeroSummary({
      accountIds: ['a'],
      cashProjections: { a: { monthly: [row('2026-10')] } },
      currentYearMonth: '2026-09',
    })).toBeNull();
    expect(deriveHeroSummary({ accountIds: [], cashProjections: {}, currentYearMonth: '2026-09' })).toBeNull();
  });
});

describe('isZeroMoney', () => {
  it('treats sub-cent values as zero', () => {
    expect(isZeroMoney(0)).toBe(true);
    expect(isZeroMoney(0.004)).toBe(true);
    expect(isZeroMoney(-0.004)).toBe(true);
    expect(isZeroMoney(0.01)).toBe(false);
    expect(isZeroMoney(-12.5)).toBe(false);
  });
});

describe('netWorthChangeVsLastMonth', () => {
  it('is undefined (badge hidden) when the projection starts at the current month', () => {
    expect(netWorthChangeVsLastMonth([{ yearMonth: '2026-09', netWorth: 1000 }], '2026-09', 1000)).toBeUndefined();
  });

  it('diffs against a real previous-month row when one exists', () => {
    expect(netWorthChangeVsLastMonth(
      [{ yearMonth: '2026-08', netWorth: 900 }, { yearMonth: '2026-09', netWorth: 1000 }],
      '2026-09',
      1100
    )).toBe(200);
  });
});
