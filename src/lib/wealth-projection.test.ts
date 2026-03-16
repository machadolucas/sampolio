import { describe, it, expect } from 'vitest';
import { calculateWealthProjection } from './wealth-projection';
import type { WealthProjectionData } from './wealth-projection';
import {
  createMockAccount,
  createMockDebt,
  createMockInvestment,
  createMockContribution,
  createMockReceivable,
  createMockReferenceRate,
  createMockExtraPayment,
} from '@/test/mocks';

function buildWealthData(overrides?: Partial<WealthProjectionData>): WealthProjectionData {
  return {
    cashAccounts: [],
    cashProjections: new Map(),
    investments: [],
    investmentContributions: new Map(),
    receivables: [],
    receivableRepayments: new Map(),
    debts: [],
    debtReferenceRates: new Map(),
    debtExtraPayments: new Map(),
    ...overrides,
  };
}

describe('calculateWealthProjection', () => {
  describe('investment projection', () => {
    it('applies compound growth correctly', () => {
      const inv = createMockInvestment({
        startingValuation: 10000,
        annualGrowthRate: 12, // ~0.949% monthly
        valuationDate: '2026-01',
      });

      const data = buildWealthData({
        investments: [inv],
        investmentContributions: new Map([[inv.id, []]]),
      });

      const result = calculateWealthProjection(data, '2026-01', '2026-12');

      expect(result).toHaveLength(12);
      // After 12 months at 12% annual, should be ~11268
      expect(result[11].investmentsTotal).toBeGreaterThan(11200);
      expect(result[11].investmentsTotal).toBeLessThan(11300);
    });

    it('includes contributions in growth', () => {
      const inv = createMockInvestment({
        startingValuation: 10000,
        annualGrowthRate: 0, // no growth, just contributions
        valuationDate: '2026-01',
      });

      const contrib = createMockContribution({
        investmentAccountId: inv.id,
        type: 'contribution',
        kind: 'recurring',
        amount: 500,
        frequency: 'monthly',
        startDate: '2026-01',
      });

      const data = buildWealthData({
        investments: [inv],
        investmentContributions: new Map([[inv.id, [contrib]]]),
      });

      const result = calculateWealthProjection(data, '2026-01', '2026-06');

      // After 6 months: 10000 + 6*500 = 13000
      expect(result[5].investmentsTotal).toBe(13000);
    });
  });

  describe('debt amortization', () => {
    it('fixed rate amortized debt reduces principal', () => {
      const debt = createMockDebt({
        debtType: 'amortized',
        initialPrincipal: 100000,
        interestModelType: 'fixed',
        fixedInterestRate: 3.6, // 0.3% monthly
        monthlyPayment: 1000,
        startDate: '2026-01',
      });

      const data = buildWealthData({
        debts: [debt],
        debtReferenceRates: new Map([[debt.id, []]]),
        debtExtraPayments: new Map([[debt.id, []]]),
      });

      const result = calculateWealthProjection(data, '2026-01', '2026-06');

      // Month 1: interest = 100000 * 0.003 = 300, principal paid = 700
      // Remaining = 99300
      expect(result[0].debtsTotal).toBeCloseTo(99300, 0);
      // Debt total should decrease each month
      expect(result[5].debtsTotal).toBeLessThan(result[0].debtsTotal);
    });

    it('extra payments reduce principal faster', () => {
      const debt = createMockDebt({
        debtType: 'amortized',
        initialPrincipal: 100000,
        interestModelType: 'fixed',
        fixedInterestRate: 3.6,
        monthlyPayment: 1000,
        startDate: '2026-01',
      });

      const extra = createMockExtraPayment({
        debtId: debt.id,
        date: '2026-03',
        amount: 5000,
      });

      const dataNoExtra = buildWealthData({
        debts: [debt],
        debtReferenceRates: new Map([[debt.id, []]]),
        debtExtraPayments: new Map([[debt.id, []]]),
      });

      const dataWithExtra = buildWealthData({
        debts: [debt],
        debtReferenceRates: new Map([[debt.id, []]]),
        debtExtraPayments: new Map([[debt.id, [extra]]]),
      });

      const resultNoExtra = calculateWealthProjection(dataNoExtra, '2026-01', '2026-06');
      const resultWithExtra = calculateWealthProjection(dataWithExtra, '2026-01', '2026-06');

      // With extra payment, debt should be lower
      expect(resultWithExtra[5].debtsTotal).toBeLessThan(resultNoExtra[5].debtsTotal);
    });

    it('fixed-installment debt reduces without interest', () => {
      const debt = createMockDebt({
        debtType: 'fixed-installment',
        initialPrincipal: 6000,
        interestModelType: 'none',
        installmentAmount: 1000,
        totalInstallments: 6,
        startDate: '2026-01',
      });

      const data = buildWealthData({
        debts: [debt],
        debtReferenceRates: new Map([[debt.id, []]]),
        debtExtraPayments: new Map([[debt.id, []]]),
      });

      const result = calculateWealthProjection(data, '2026-01', '2026-06');

      expect(result[0].debtsTotal).toBe(5000);  // 6000 - 1000
      expect(result[5].debtsTotal).toBe(0);      // Fully paid
    });

    it('variable rate debt uses reference rates', () => {
      const debt = createMockDebt({
        debtType: 'amortized',
        initialPrincipal: 100000,
        interestModelType: 'variable',
        referenceRateMargin: 1.0,
        monthlyPayment: 1000,
        startDate: '2026-01',
      });

      const rate = createMockReferenceRate({
        debtId: debt.id,
        yearMonth: '2026-01',
        rate: 2.5, // reference rate
      });

      const data = buildWealthData({
        debts: [debt],
        debtReferenceRates: new Map([[debt.id, [rate]]]),
        debtExtraPayments: new Map([[debt.id, []]]),
      });

      const result = calculateWealthProjection(data, '2026-01', '2026-06');

      // Effective rate = 2.5 + 1.0 = 3.5% annual
      // Monthly rate = 3.5/100/12 = 0.002917
      // Month 1 interest: 100000 * 0.002917 ≈ 291.67
      // Principal paid: 1000 - 291.67 ≈ 708.33
      expect(result[0].debtsTotal).toBeGreaterThan(99200);
      expect(result[0].debtsTotal).toBeLessThan(99400);
    });
  });

  describe('receivable projection', () => {
    it('repayments reduce balance', () => {
      const rec = createMockReceivable({
        initialPrincipal: 5000,
        currentBalance: 5000,
        hasInterest: false,
        expectedMonthlyRepayment: 500,
        startDate: '2026-01',
      });

      const data = buildWealthData({
        receivables: [rec],
        receivableRepayments: new Map([[rec.id, []]]),
      });

      const result = calculateWealthProjection(data, '2026-01', '2026-06');

      // Expected: 5000, 4500, 4000, 3500, 3000, 2500
      expect(result[0].receivablesTotal).toBe(4500);
      expect(result[5].receivablesTotal).toBe(2000);
    });

    it('interest accrues on receivable', () => {
      const rec = createMockReceivable({
        initialPrincipal: 10000,
        currentBalance: 10000,
        hasInterest: true,
        annualInterestRate: 12, // 1% monthly
        expectedMonthlyRepayment: 0,
        startDate: '2026-01',
      });

      const data = buildWealthData({
        receivables: [rec],
        receivableRepayments: new Map([[rec.id, []]]),
      });

      const result = calculateWealthProjection(data, '2026-01', '2026-03');

      // Month 1: 10000 + 100 = 10100
      expect(result[0].receivablesTotal).toBeCloseTo(10100, 0);
    });
  });

  describe('net worth aggregation', () => {
    it('calculates net worth = assets - liabilities', () => {
      const account = createMockAccount({
        startingBalance: 10000,
        startingDate: '2026-01',
        planningHorizonMonths: 3,
      });
      const inv = createMockInvestment({
        startingValuation: 5000,
        annualGrowthRate: 0,
        valuationDate: '2026-01',
      });
      const debt = createMockDebt({
        debtType: 'fixed-installment',
        initialPrincipal: 3000,
        interestModelType: 'none',
        installmentAmount: 1000,
        totalInstallments: 3,
        startDate: '2026-01',
      });

      const data = buildWealthData({
        cashAccounts: [account],
        cashProjections: new Map([[account.id, [
          { yearMonth: '2026-01', year: 2026, month: 1, startingBalance: 10000, totalIncome: 0, totalExpenses: 0, netChange: 0, endingBalance: 10000, incomeBreakdown: [], expenseBreakdown: [] },
          { yearMonth: '2026-02', year: 2026, month: 2, startingBalance: 10000, totalIncome: 0, totalExpenses: 0, netChange: 0, endingBalance: 10000, incomeBreakdown: [], expenseBreakdown: [] },
          { yearMonth: '2026-03', year: 2026, month: 3, startingBalance: 10000, totalIncome: 0, totalExpenses: 0, netChange: 0, endingBalance: 10000, incomeBreakdown: [], expenseBreakdown: [] },
        ]]]),
        investments: [inv],
        investmentContributions: new Map([[inv.id, []]]),
        debts: [debt],
        debtReferenceRates: new Map([[debt.id, []]]),
        debtExtraPayments: new Map([[debt.id, []]]),
      });

      const result = calculateWealthProjection(data, '2026-01', '2026-03');

      // Month 1: cash 10000 + inv 5000 - debt 2000 = 13000
      expect(result[0].netWorth).toBe(13000);
      // Month 3: cash 10000 + inv 5000 - debt 0 = 15000
      expect(result[2].netWorth).toBe(15000);
    });
  });
});
