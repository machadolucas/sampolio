import { describe, it, expect } from 'vitest';
import {
  calculateMortgageProjection,
  dayCountFraction,
  recomputeAnnuityPayment,
  getEffectiveAnnualRate,
  getEffectiveCost,
  computeAspSubsidy,
  getPayoffMonth,
  getMemberPositionForMonth,
  type MortgageProjectionInput,
} from './mortgage-projection';
import {
  createMockSharedMortgage,
  createMockMortgageRate,
  createMockMortgageCost,
  createMockMortgageExtraPayment,
  createMockMortgageSnapshot,
  createMockMortgageActual,
} from '@/test/mocks';
import type { MortgageRateEntry } from '@/types';

// The four real Euribor resets (stored EXCLUDING the 0.4% margin).
const REAL_RATES: MortgageRateEntry[] = [
  createMockMortgageRate({ effectiveDate: '2022-12', euriborRate: 2.963 }), // 3.363%
  createMockMortgageRate({ effectiveDate: '2023-12', euriborRate: 3.644 }), // 4.044%
  createMockMortgageRate({ effectiveDate: '2024-12', euriborRate: 2.405 }), // 2.805%
  createMockMortgageRate({ effectiveDate: '2025-12', euriborRate: 2.31 }), //  2.71%
];

function buildInput(overrides?: Partial<MortgageProjectionInput>): MortgageProjectionInput {
  return {
    mortgage: createMockSharedMortgage(),
    rates: REAL_RATES,
    costs: [
      createMockMortgageCost({ type: 'invoicing-fee', effectiveDate: '2023-02', amount: 5.4 }),
      createMockMortgageCost({ type: 'service-fee', effectiveDate: '2023-02', amount: 2.5 }),
      createMockMortgageCost({ type: 'loan-insurance', loanId: 'loan-asp', effectiveDate: '2023-04', amount: 36.65 }),
      createMockMortgageCost({ type: 'loan-insurance', loanId: 'loan-regular', effectiveDate: '2023-04', amount: 40.05 }),
    ],
    extraPayments: [],
    snapshots: [],
    ...overrides,
  };
}

describe('mortgage-projection engine', () => {
  describe('day-count fraction', () => {
    it('30E/360 is exactly 1/12', () => {
      expect(dayCountFraction({ dayCount: '30E/360' }, '2026-01', '2026-02')).toBeCloseTo(1 / 12, 10);
    });
    it('actual/360 uses calendar days of the period month', () => {
      expect(dayCountFraction({ dayCount: 'actual/360' }, '2026-02', '2026-03')).toBeCloseTo(31 / 360, 10);
      expect(dayCountFraction({ dayCount: 'actual/360' }, '2026-01', '2026-02')).toBeCloseTo(28 / 360, 10);
    });
    it('actual/360 uses exact day-spans when a payment day is set', () => {
      // 14 Jan → 14 Feb = 31 days
      const frac = dayCountFraction({ dayCount: 'actual/360', paymentDayOfMonth: 14 }, '2026-01', '2026-02');
      expect(frac).toBeCloseTo(31 / 360, 10);
    });
  });

  describe('annuity payment', () => {
    it('zero rate splits the balance evenly over the term', () => {
      expect(recomputeAnnuityPayment(120000, 0, 240)).toBeCloseTo(500, 6);
    });
    it('positive rate matches the closed-form annuity', () => {
      // 100000 @ 6%/yr over 360 months ≈ 599.55
      expect(recomputeAnnuityPayment(100000, 6, 360)).toBeCloseTo(599.55, 1);
    });
  });

  describe('rate & cost lookups', () => {
    it('picks the most recent effective rate and adds the margin', () => {
      expect(getEffectiveAnnualRate({ margin: 0.4 }, REAL_RATES, '2025-06')).toBeCloseTo(2.805, 6);
      expect(getEffectiveAnnualRate({ margin: 0.4 }, REAL_RATES, '2026-06')).toBeCloseTo(2.71, 6);
    });
    it('a fee change applies only from its effective month forward', () => {
      const costs = [
        createMockMortgageCost({ type: 'invoicing-fee', effectiveDate: '2023-02', amount: 5.4 }),
        createMockMortgageCost({ type: 'invoicing-fee', effectiveDate: '2026-01', amount: 7.0 }),
      ];
      expect(getEffectiveCost(costs, 'invoicing-fee', undefined, '2025-12')).toBe(5.4);
      expect(getEffectiveCost(costs, 'invoicing-fee', undefined, '2026-01')).toBe(7.0);
      expect(getEffectiveCost(costs, 'invoicing-fee', undefined, '2022-01')).toBe(0);
    });
  });

  describe('full schedule from genesis', () => {
    const months = calculateMortgageProjection(buildInput(), '2050-12');

    it('starts at genesis with the full borrowed balance', () => {
      expect(months[0].yearMonth).toBe('2023-02');
      expect(months[0].totalRemaining).toBeGreaterThan(290000);
      expect(months[0].totalRemaining).toBeLessThanOrEqual(293000);
    });

    it('every total equals the sum of its per-loan components', () => {
      for (const m of months) {
        const sumRemaining = m.loans.reduce((s, l) => s + l.endingPrincipal, 0);
        const sumInterest = m.loans.reduce((s, l) => s + l.interestPaid, 0);
        const sumInsurance = m.loans.reduce((s, l) => s + l.insurance, 0);
        expect(m.totalRemaining).toBeCloseTo(sumRemaining, 6);
        expect(m.totalInterest).toBeCloseTo(sumInterest, 6);
        expect(m.totalInsurance).toBeCloseTo(sumInsurance, 6);
        expect(m.principalPaidTotal).toBeCloseTo(293000 - m.totalRemaining, 4);
      }
    });

    it('balance decreases monotonically and pays off near the term', () => {
      const payoff = getPayoffMonth(months);
      expect(payoff).not.toBeNull();
      // ~25 years from early-2023 genesis → late 2040s.
      expect(payoff! >= '2046-01' && payoff! <= '2049-12').toBe(true);
    });

    it('reproduces the spreadsheet remaining balance at 2026-06 (within model tolerance)', () => {
      const june = months.find((m) => m.yearMonth === '2026-06')!;
      expect(june.totalRemaining).toBeGreaterThan(255000);
      expect(june.totalRemaining).toBeLessThan(280000);
    });
  });

  describe('ownership / equity identities', () => {
    const months = calculateMortgageProjection(buildInput(), '2050-12');

    it('each member stake is constant and the two stakes sum to the house price', () => {
      for (const m of months) {
        const sumStake = m.members.reduce((s, p) => s + p.stake, 0);
        expect(sumStake).toBeCloseTo(328000, 0);
        for (const p of m.members) {
          // equity == stake − liability, exactly
          expect(p.equity).toBeCloseTo(p.stake - p.liability, 6);
        }
      }
    });

    it('member stakes are ~€164k each (half the house)', () => {
      const first = months[0];
      for (const p of first.members) expect(p.stake).toBeCloseTo(164000, -2);
    });

    it('liability shrinks and ownership converges toward 50% at payoff', () => {
      const payoff = getPayoffMonth(months)!;
      const lucas = getMemberPositionForMonth(months, 'lucas', payoff)!;
      const marja = getMemberPositionForMonth(months, 'marja', payoff)!;
      expect(lucas.liability).toBeCloseTo(0, 0);
      expect(marja.liability).toBeCloseTo(0, 0);
      expect(lucas.ownershipPercent).toBeCloseTo(0.5, 2);
      expect(marja.ownershipPercent).toBeCloseTo(0.5, 2);
    });
  });

  describe('ASP subsidy', () => {
    it('is zero at sub-threshold rates (2.71% < 3.8%)', () => {
      const months = calculateMortgageProjection(buildInput(), '2030-12');
      const totalSubsidy = months.reduce((s, m) => s + m.totalSubsidy, 0);
      expect(totalSubsidy).toBe(0);
    });

    it('activates on the ASP loan when the rate exceeds 3.8%', () => {
      const mortgage = createMockSharedMortgage();
      mortgage.loans[0].aspSubsidy = {
        enabled: true,
        thresholdRate: 3.8,
        subsidyShare: 0.7,
        eligibilityYears: 10,
      };
      const rates = [createMockMortgageRate({ effectiveDate: '2022-12', euriborRate: 4.6 })]; // 5.0% total
      const months = calculateMortgageProjection(buildInput({ mortgage, rates }), '2026-12');
      const aspRow = months[2].loans.find((l) => l.loanId === 'loan-asp')!;
      const regularRow = months[2].loans.find((l) => l.loanId === 'loan-regular')!;
      // ASP gets a subsidy proportional to the rate above the threshold; regular never does.
      const expectedFraction = (5.0 - 3.8) / 5.0; // 0.24
      expect(aspRow.subsidy).toBeCloseTo(aspRow.interestAccrued * expectedFraction * 0.7, 4);
      expect(regularRow.subsidy).toBe(0);
      expect(computeAspSubsidy(mortgage.loans[1], 5.0, 100, 0)).toBe(0); // regular loan helper
    });
  });

  describe('extra payments', () => {
    it('shorten-term keeps the payment and finishes the loan earlier', () => {
      // Overall payoff is governed by whichever loan finishes last, so check the
      // targeted sub-loan's own payoff month.
      const loanPayoff = (months: ReturnType<typeof calculateMortgageProjection>, loanId: string) =>
        months.find((m) => (m.loans.find((l) => l.loanId === loanId)?.endingPrincipal ?? 1) <= 0.005)?.yearMonth ?? '9999-12';
      const base = calculateMortgageProjection(buildInput(), '2050-12');
      const withExtra = calculateMortgageProjection(
        buildInput({
          extraPayments: [
            createMockMortgageExtraPayment({ loanId: 'loan-regular', date: '2026-01', amount: 20000, mode: 'shorten-term' }),
          ],
        }),
        '2050-12'
      );
      expect(loanPayoff(withExtra, 'loan-regular') < loanPayoff(base, 'loan-regular')).toBe(true);
    });

    it('lower-payment keeps the term and reduces later installments', () => {
      const base = calculateMortgageProjection(buildInput(), '2050-12');
      const withExtra = calculateMortgageProjection(
        buildInput({
          extraPayments: [
            createMockMortgageExtraPayment({ loanId: 'loan-regular', date: '2026-01', amount: 20000, mode: 'lower-payment' }),
          ],
        }),
        '2050-12'
      );
      const baseRegAfter = base.find((m) => m.yearMonth === '2026-06')!.loans.find((l) => l.loanId === 'loan-regular')!;
      const lowerRegAfter = withExtra.find((m) => m.yearMonth === '2026-06')!.loans.find((l) => l.loanId === 'loan-regular')!;
      expect(lowerRegAfter.scheduledPayment).toBeLessThan(baseRegAfter.scheduledPayment);
    });
  });

  describe('drift re-anchor', () => {
    it('re-bases the loan balance from a snapshot month, leaving earlier months untouched', () => {
      const base = calculateMortgageProjection(buildInput(), '2030-12');
      const drifted = calculateMortgageProjection(
        buildInput({
          snapshots: [
            createMockMortgageSnapshot({ loanId: 'loan-regular', yearMonth: '2025-06', actualBalance: 120000 }),
          ],
        }),
        '2030-12'
      );
      const before = '2025-01';
      expect(drifted.find((m) => m.yearMonth === before)!.totalRemaining).toBeCloseTo(
        base.find((m) => m.yearMonth === before)!.totalRemaining,
        4
      );
      // From the snapshot on, the regular loan starts at the observed 120000.
      const at = drifted.find((m) => m.yearMonth === '2025-06')!.loans.find((l) => l.loanId === 'loan-regular')!;
      expect(at.startingPrincipal).toBeCloseTo(120000, 6);
    });
  });

  // Validation against the family's real Apple Numbers "Loan progress" table.
  // Actuals are the bank's exact remaining balances. The engine auto-amortizes
  // from terms, so it tracks the real balance closely but not exactly (a clean
  // annuity can't reproduce the bank's irregular early payments). The bank
  // applies each Dec Euribor reset from February, so rates are seeded with their
  // real effective month here.
  describe('matches the real spreadsheet (Loan progress)', () => {
    // Total remaining (|F|) at each checkpoint, straight from the spreadsheet.
    const ACTUAL_TOTAL: Record<string, number> = {
      '2023-02': 293000.0,
      '2023-06': 291666.4,
      '2023-12': 287782.17,
      '2024-06': 284332.32,
      '2024-12': 280677.59,
      '2025-06': 276251.88,
      '2025-12': 271823.65,
      '2026-06': 267278.86,
    };
    const realRates = buildInput({
      rates: [
        createMockMortgageRate({ effectiveDate: '2022-12', euriborRate: 2.963 }),
        createMockMortgageRate({ effectiveDate: '2024-02', euriborRate: 3.644 }),
        createMockMortgageRate({ effectiveDate: '2025-02', euriborRate: 2.405 }),
        createMockMortgageRate({ effectiveDate: '2026-02', euriborRate: 2.31 }),
      ],
    });
    const months = calculateMortgageProjection(realRates, '2026-06');
    const at = (ym: string) => months.find((m) => m.yearMonth === ym)!;

    it('tracks the real remaining balance within ~0.7% at every checkpoint', () => {
      for (const [ym, actual] of Object.entries(ACTUAL_TOTAL)) {
        const engine = at(ym).totalRemaining;
        const errorPct = Math.abs(engine - actual) / actual;
        expect(errorPct, `${ym}: engine ${engine.toFixed(0)} vs actual ${actual}`).toBeLessThan(0.007);
      }
    });

    it('matches the per-loan split at the current month within ~€700', () => {
      const june = at('2026-06');
      const asp = june.loans.find((l) => l.loanId === 'loan-asp')!;
      const reg = june.loans.find((l) => l.loanId === 'loan-regular')!;
      expect(Math.abs(asp.endingPrincipal - 127710.04)).toBeLessThan(700);
      expect(Math.abs(reg.endingPrincipal - 139568.82)).toBeLessThan(700);
    });

    it('a drift snapshot re-anchors exactly to the bank figures', () => {
      const drifted = calculateMortgageProjection(
        buildInput({
          rates: realRates.rates,
          snapshots: [
            createMockMortgageSnapshot({ loanId: 'loan-asp', yearMonth: '2026-06', actualBalance: 127710.04 }),
            createMockMortgageSnapshot({ loanId: 'loan-regular', yearMonth: '2026-06', actualBalance: 139568.82 }),
          ],
        }),
        '2026-06'
      );
      const june = drifted.find((m) => m.yearMonth === '2026-06')!;
      expect(june.loans.find((l) => l.loanId === 'loan-asp')!.startingPrincipal).toBeCloseTo(127710.04, 2);
      expect(june.loans.find((l) => l.loanId === 'loan-regular')!.startingPrincipal).toBeCloseTo(139568.82, 2);
    });

    it('matches each person\'s monthly transfer within ~€12 (deposits incl. insurance)', () => {
      const june = at('2026-06');
      const lucas = june.members.find((p) => p.userId === 'lucas')!;
      const marja = june.members.find((p) => p.userId === 'marja')!;
      expect(Math.abs(lucas.monthlyDeposit - 663.31)).toBeLessThan(12); // spreadsheet "Lucas deposits"
      expect(Math.abs(marja.monthlyDeposit - 797.21)).toBeLessThan(12); // spreadsheet "Marja deposits"
    });
  });

  // With the bank's ACTUAL monthly figures imported, the ledger must reproduce
  // the spreadsheet EXACTLY (zero delta) — that's the whole point of the import.
  describe('reproduces the spreadsheet EXACTLY when actuals are imported', () => {
    // Real rows from the spreadsheet's "Loan progress" table.
    const ACTUALS = [
      // genesis interest-only month: principal stays at the full balance
      { loanId: 'loan-asp', yearMonth: '2023-02', remaining: 140000, repayment: 612.54, interest: 609.84, insurance: 0 },
      { loanId: 'loan-regular', yearMonth: '2023-02', remaining: 153000, repayment: 669.17, interest: 666.47, insurance: 0 },
      // current month
      { loanId: 'loan-asp', yearMonth: '2026-06', remaining: 127710.04, repayment: 695.59, interest: 270.0, insurance: 36.65 },
      { loanId: 'loan-regular', yearMonth: '2026-06', remaining: 139568.82, repayment: 759.93, interest: 295.07, insurance: 40.05 },
    ].map((a) => createMockMortgageActual(a));

    const months = calculateMortgageProjection(
      buildInput({
        rates: [createMockMortgageRate({ effectiveDate: '2022-12', euriborRate: 2.963 })],
        costs: [createMockMortgageCost({ type: 'service-fee', effectiveDate: '2023-02', amount: 2.5 })],
        actuals: ACTUALS,
      }),
      '2026-06'
    );
    const at = (ym: string) => months.find((m) => m.yearMonth === ym)!;

    it('interest-only genesis month keeps the full balance (zero principal)', () => {
      const feb = at('2023-02');
      expect(feb.totalRemaining).toBeCloseTo(293000, 2);
      expect(feb.isAllActual).toBe(true);
      expect(feb.loans.every((l) => l.isActual)).toBe(true);
    });

    it('current-month balance, interest and deposits match the spreadsheet to the cent', () => {
      const june = at('2026-06');
      expect(june.totalRemaining).toBeCloseTo(267278.86, 2);
      expect(june.loans.find((l) => l.loanId === 'loan-asp')!.endingPrincipal).toBeCloseTo(127710.04, 2);
      expect(june.loans.find((l) => l.loanId === 'loan-regular')!.endingPrincipal).toBeCloseTo(139568.82, 2);
      expect(june.totalInterest).toBeCloseTo(565.07, 2);
      expect(june.totalCharge).toBeCloseTo(1455.52, 2); // spreadsheet "total repayment"
      expect(june.members.find((p) => p.userId === 'lucas')!.monthlyDeposit).toBeCloseTo(663.31, 1);
      expect(june.members.find((p) => p.userId === 'marja')!.monthlyDeposit).toBeCloseTo(797.21, 1);
    });
  });
});
