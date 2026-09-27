import { describe, it, expect } from 'vitest';
import { getDebtPayoffInfo, getDebtOriginalPrincipal } from './debt-utils';
import { calculateDebtAmortization } from './wealth-projection';
import { createMockDebt, createMockSnapshot } from '@/test/mocks';
import type { DebtAmortizationRow } from '@/types';

function createRow(overrides: Partial<DebtAmortizationRow>): DebtAmortizationRow {
  return {
    yearMonth: '2026-01',
    startingPrincipal: 100000,
    interestPaid: 291.67,
    principalPaid: 208.33,
    totalPayment: 500,
    endingPrincipal: 99791.67,
    interestRate: 3.5,
    ...overrides,
  };
}

describe('getDebtPayoffInfo', () => {
  describe('amortized debt with rows', () => {
    it('calculates correct percentPaid, remaining, payoff date, and monthly payment', () => {
      const debt = createMockDebt({
        debtType: 'amortized',
        initialPrincipal: 100000,
        monthlyPayment: 500,
        interestModelType: 'fixed',
        fixedInterestRate: 3.5,
      });

      const rows: DebtAmortizationRow[] = [
        createRow({
          yearMonth: '2026-01',
          startingPrincipal: 100000,
          principalPaid: 208.33,
          endingPrincipal: 99791.67,
        }),
        createRow({
          yearMonth: '2026-02',
          startingPrincipal: 99791.67,
          principalPaid: 209.94,
          endingPrincipal: 99581.73,
        }),
        createRow({
          yearMonth: '2026-03',
          startingPrincipal: 99581.73,
          principalPaid: 210.55,
          endingPrincipal: 99371.18,
        }),
      ];

      const info = getDebtPayoffInfo(debt, rows);

      expect(info.remaining).toBeCloseTo(99371.18, 2);
      expect(info.amountPaid).toBeCloseTo(628.82, 2);
      expect(info.percentPaid).toBeCloseTo(0.63, 1);
      expect(info.estimatedPayoffDate).toBeNull();
      expect(info.monthlyPayment).toBe(500);
    });

    it('finds estimated payoff date when a row reaches zero', () => {
      const debt = createMockDebt({
        debtType: 'amortized',
        initialPrincipal: 1000,
        monthlyPayment: 600,
      });

      const rows: DebtAmortizationRow[] = [
        createRow({
          yearMonth: '2026-01',
          startingPrincipal: 1000,
          principalPaid: 500,
          endingPrincipal: 500,
        }),
        createRow({
          yearMonth: '2026-02',
          startingPrincipal: 500,
          principalPaid: 500,
          endingPrincipal: 0,
        }),
      ];

      const info = getDebtPayoffInfo(debt, rows);

      expect(info.remaining).toBe(0);
      expect(info.amountPaid).toBe(1000);
      expect(info.percentPaid).toBe(100);
      expect(info.estimatedPayoffDate).toBe('2026-02');
      expect(info.monthlyPayment).toBe(600);
    });
  });

  describe('fixed-installment debt', () => {
    it('uses installmentAmount and calculates correctly', () => {
      const debt = createMockDebt({
        debtType: 'fixed-installment',
        initialPrincipal: 6000,
        installmentAmount: 500,
        totalInstallments: 12,
        remainingInstallments: 8,
        interestModelType: 'none',
      });

      const rows: DebtAmortizationRow[] = [
        createRow({
          yearMonth: '2025-05',
          startingPrincipal: 6000,
          interestPaid: 0,
          principalPaid: 500,
          totalPayment: 500,
          endingPrincipal: 5500,
          interestRate: 0,
        }),
        createRow({
          yearMonth: '2025-06',
          startingPrincipal: 5500,
          interestPaid: 0,
          principalPaid: 500,
          totalPayment: 500,
          endingPrincipal: 5000,
          interestRate: 0,
        }),
        createRow({
          yearMonth: '2025-07',
          startingPrincipal: 5000,
          interestPaid: 0,
          principalPaid: 500,
          totalPayment: 500,
          endingPrincipal: 4500,
          interestRate: 0,
        }),
        createRow({
          yearMonth: '2025-08',
          startingPrincipal: 4500,
          interestPaid: 0,
          principalPaid: 500,
          totalPayment: 500,
          endingPrincipal: 4000,
          interestRate: 0,
        }),
      ];

      const info = getDebtPayoffInfo(debt, rows);

      expect(info.remaining).toBe(4000);
      expect(info.amountPaid).toBe(2000);
      expect(info.percentPaid).toBeCloseTo(33.33, 1);
      expect(info.estimatedPayoffDate).toBeNull();
      expect(info.monthlyPayment).toBe(500);
    });
  });

  describe('no amortization rows', () => {
    it('remaining equals initialPrincipal and 0% paid', () => {
      const debt = createMockDebt({
        debtType: 'amortized',
        initialPrincipal: 50000,
        monthlyPayment: 800,
      });

      const info = getDebtPayoffInfo(debt, []);

      expect(info.remaining).toBe(50000);
      expect(info.amountPaid).toBe(0);
      expect(info.percentPaid).toBe(0);
      expect(info.estimatedPayoffDate).toBeNull();
      expect(info.monthlyPayment).toBe(800);
    });
  });

  describe('debt fully paid', () => {
    it('returns 100% paid, remaining 0', () => {
      const debt = createMockDebt({
        debtType: 'amortized',
        initialPrincipal: 2000,
        monthlyPayment: 1100,
      });

      const rows: DebtAmortizationRow[] = [
        createRow({
          yearMonth: '2026-01',
          startingPrincipal: 2000,
          principalPaid: 1000,
          endingPrincipal: 1000,
        }),
        createRow({
          yearMonth: '2026-02',
          startingPrincipal: 1000,
          principalPaid: 1000,
          endingPrincipal: 0,
        }),
      ];

      const info = getDebtPayoffInfo(debt, rows);

      expect(info.remaining).toBe(0);
      expect(info.amountPaid).toBe(2000);
      expect(info.percentPaid).toBe(100);
      expect(info.estimatedPayoffDate).toBe('2026-02');
      expect(info.monthlyPayment).toBe(1100);
    });

    it('clamps percentPaid to 100 even if remaining is negative', () => {
      const debt = createMockDebt({
        debtType: 'amortized',
        initialPrincipal: 1000,
        monthlyPayment: 600,
      });

      const rows: DebtAmortizationRow[] = [
        createRow({
          yearMonth: '2026-01',
          startingPrincipal: 1000,
          principalPaid: 600,
          endingPrincipal: 400,
        }),
        createRow({
          yearMonth: '2026-02',
          startingPrincipal: 400,
          principalPaid: 600,
          endingPrincipal: -200,
        }),
      ];

      const info = getDebtPayoffInfo(debt, rows);

      expect(info.remaining).toBe(-200);
      expect(info.percentPaid).toBe(100);
      expect(info.estimatedPayoffDate).toBe('2026-02');
    });
  });
});

describe('getDebtPayoffInfo with a long payoff horizon (drawer usage)', () => {
  const debt = createMockDebt({
    debtType: 'amortized', initialPrincipal: 20000, startDate: '2024-01',
    interestModelType: 'fixed', fixedInterestRate: 3, monthlyPayment: 400,
  });
  const rows = calculateDebtAmortization(debt, [], [], debt.startDate, '2066-01');

  it('reads remaining from the current month, not the final payoff row', () => {
    const info = getDebtPayoffInfo(debt, rows, { currentMonth: '2026-09' });
    const current = rows.find(r => r.yearMonth === '2026-09')!;
    expect(info.remaining).toBeCloseTo(current.endingPrincipal, 6);
    expect(info.remaining).toBeGreaterThan(0);
    expect(info.percentPaid).toBeGreaterThan(0);
    expect(info.percentPaid).toBeLessThan(100);
    expect(info.estimatedPayoffDate).toBe(rows[rows.length - 1].yearMonth);
  });

  it('reports 0 remaining after the payoff month and the start principal before the first row', () => {
    expect(getDebtPayoffInfo(debt, rows, { currentMonth: '2070-01' }).remaining).toBe(0);
    expect(getDebtPayoffInfo(debt, rows, { currentMonth: '2023-06' }).remaining).toBe(20000);
  });

  it('measures progress against the recovered original principal after a check-in', () => {
    // A check-in rewrote initialPrincipal to the confirmed balance.
    const checkedIn = { ...debt, initialPrincipal: 12000 };
    const snap = createMockSnapshot({
      entityType: 'debt', entityId: debt.id, yearMonth: '2026-03',
      expectedBalance: -20000, actualBalance: -12000,
    });
    const anchoredRows = calculateDebtAmortization(checkedIn, [], [], checkedIn.startDate, '2066-01', snap);
    const original = getDebtOriginalPrincipal(checkedIn, [snap]);
    expect(original).toBe(20000);
    const info = getDebtPayoffInfo(checkedIn, anchoredRows, { currentMonth: '2026-09', originalPrincipal: original });
    expect(info.principalBase).toBe(20000);
    expect(info.remaining).toBeLessThan(12000);
    expect(info.percentPaid).toBeGreaterThan(40);
    expect(info.percentPaid).toBeLessThan(100);
  });

  it('prefers the stored originalPrincipal when projected check-ins recorded no larger balance', () => {
    // New-style check-in: expected == actual == projected balance (900), and the
    // pre-check-in principal (1200) was kept in originalPrincipal.
    const checkedIn = { ...debt, initialPrincipal: 900, originalPrincipal: 1200 };
    const snap = createMockSnapshot({
      entityType: 'debt', entityId: debt.id, yearMonth: '2026-04',
      expectedBalance: -900, actualBalance: -900,
    });
    expect(getDebtOriginalPrincipal(checkedIn, [snap])).toBe(1200);
    expect(getDebtOriginalPrincipal({ ...debt, initialPrincipal: 900 }, [snap])).toBe(900);
  });
});
