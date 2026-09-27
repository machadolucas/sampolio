import type { BalanceSnapshot, Debt, DebtAmortizationRow, YearMonth } from '@/types';

export interface DebtPayoffInfo {
  percentPaid: number; // 0-100
  amountPaid: number;
  remaining: number;
  /** The principal the percentage is measured against (see getDebtPayoffInfo). */
  principalBase: number;
  estimatedPayoffDate: string | null; // YYYY-MM or null
  monthlyPayment: number;
}

export interface DebtPayoffOptions {
  /**
   * Month whose end-of-month principal counts as "remaining" (same value the
   * Overview shows for that month). Omitted → the last row (legacy behavior,
   * only correct when the rows stop at the month of interest).
   */
  currentMonth?: YearMonth;
  /** Best known original principal (see getDebtOriginalPrincipal). */
  originalPrincipal?: number;
}

/**
 * Best available estimate of a debt's original principal. `Debt.initialPrincipal`
 * is overwritten with the confirmed balance by every monthly check-in
 * (applyReconciliationBalances), so it is only a lower bound once a debt has
 * been reconciled; `Debt.originalPrincipal` keeps the value from before the
 * first check-in. For debts reconciled before that field existed, the largest
 * balance recorded in their snapshots (early check-ins prefilled the expected
 * value with the then untouched initialPrincipal) recovers it in most cases.
 */
export function getDebtOriginalPrincipal(debt: Debt, snapshots: BalanceSnapshot[] = []): number {
  // `originalPrincipal` is captured before the first check-in overwrites
  // `initialPrincipal`; the snapshot scan remains the fallback for debts
  // reconciled before that field existed.
  let base = Math.max(debt.initialPrincipal, debt.originalPrincipal ?? 0);
  for (const s of snapshots) {
    base = Math.max(base, Math.abs(s.expectedBalance), Math.abs(s.actualBalance));
  }
  return base;
}

function remainingAt(rows: DebtAmortizationRow[], month: YearMonth | undefined, fallback: number): number {
  if (rows.length === 0) return fallback;
  if (month === undefined) return rows[rows.length - 1].endingPrincipal;
  const row = rows.find((r) => r.yearMonth === month);
  if (row) return row.endingPrincipal;
  if (month < rows[0].yearMonth) return rows[0].startingPrincipal;
  // Past the last row: paid off (0) or beyond the computed horizon.
  return rows[rows.length - 1].endingPrincipal;
}

export function getDebtPayoffInfo(
  debt: Debt,
  amortizationRows: DebtAmortizationRow[],
  options: DebtPayoffOptions = {}
): DebtPayoffInfo {
  // Remaining principal at the month of interest — never simply the last row
  // of a long payoff-horizon schedule, which always ends at 0.
  const remaining = remainingAt(amortizationRows, options.currentMonth, debt.initialPrincipal);

  const principalBase = Math.max(
    options.originalPrincipal ?? debt.initialPrincipal,
    amortizationRows[0]?.startingPrincipal ?? 0,
    remaining
  );
  const amountPaid = principalBase - remaining;

  // Clamp percentPaid to 0-100
  const rawPercent =
    principalBase > 0
      ? (amountPaid / principalBase) * 100
      : 0;
  const percentPaid = Math.min(100, Math.max(0, rawPercent));

  // Estimated payoff date: yearMonth of first row where endingPrincipal <= 0
  const payoffRow = amortizationRows.find((row) => row.endingPrincipal <= 0);
  const estimatedPayoffDate = payoffRow ? payoffRow.yearMonth : null;

  // Monthly payment depends on debt type
  let monthlyPayment: number;
  if (debt.debtType === 'amortized') {
    monthlyPayment = debt.monthlyPayment ?? 0;
  } else if (debt.debtType === 'fixed-installment') {
    monthlyPayment = debt.installmentAmount ?? 0;
  } else {
    monthlyPayment = 0;
  }

  return {
    percentPaid,
    amountPaid,
    remaining,
    principalBase,
    estimatedPayoffDate,
    monthlyPayment,
  };
}
