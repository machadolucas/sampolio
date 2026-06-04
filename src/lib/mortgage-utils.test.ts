import { describe, it, expect } from 'vitest';
import { deriveLoanShares, isEuriborUpdateDue } from './mortgage-utils';
import { createMockMortgageRate } from '@/test/mocks';

describe('deriveLoanShares', () => {
  it('reproduces the spreadsheet 45.4 / 54.6 split from the down payments', () => {
    const shares = deriveLoanShares(328000, [31000, 4000], [0.5, 0.5]);
    expect(shares[0]).toBeCloseTo(0.454, 3);
    expect(shares[1]).toBeCloseTo(0.546, 3);
    expect(shares[0] + shares[1]).toBeCloseTo(1, 10);
  });

  it('equal down payments give an equal split', () => {
    const shares = deriveLoanShares(300000, [50000, 50000], [0.5, 0.5]);
    expect(shares[0]).toBeCloseTo(0.5, 10);
    expect(shares[1]).toBeCloseTo(0.5, 10);
  });

  it('unequal targets shift the loan share accordingly', () => {
    // Equal down payments but a 60/40 target → person aiming for 60% carries more loan.
    const shares = deriveLoanShares(300000, [50000, 50000], [0.6, 0.4]);
    expect(shares[0]).toBeGreaterThan(shares[1]);
    expect(shares[0] + shares[1]).toBeCloseTo(1, 10);
  });

  it('falls back to an even split when everyone is already at target', () => {
    const shares = deriveLoanShares(300000, [150000, 150000], [0.5, 0.5]);
    expect(shares[0]).toBeCloseTo(0.5, 10);
  });
});

describe('isEuriborUpdateDue', () => {
  const mortgage = { rateResetMonth: 12, rateResetDay: 14 };

  it('is due in the window after a reset when no rate for the cycle exists', () => {
    const now = new Date(2026, 11, 20); // 20 Dec 2026, just after the reset
    const info = isEuriborUpdateDue(mortgage, [createMockMortgageRate({ effectiveDate: '2025-12' })], now);
    expect(info.due).toBe(true);
    expect(info.resetYearMonth).toBe('2026-12');
  });

  it('is not due once the current cycle rate is entered', () => {
    const now = new Date(2026, 11, 20);
    const info = isEuriborUpdateDue(mortgage, [createMockMortgageRate({ effectiveDate: '2026-12' })], now);
    expect(info.due).toBe(false);
  });

  it('is not due mid-year (far from the reset date)', () => {
    const now = new Date(2026, 5, 1); // June
    const info = isEuriborUpdateDue(mortgage, [createMockMortgageRate({ effectiveDate: '2025-12' })], now);
    expect(info.due).toBe(false);
    expect(info.nextResetDate.getFullYear()).toBe(2026);
    expect(info.nextResetDate.getMonth()).toBe(11);
  });
});
