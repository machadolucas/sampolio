/**
 * Monthly check-in prefill for non-cash entities.
 *
 * The check-in writes a balance snapshot for every confirmed row, and the
 * wealth engines re-anchor on the latest snapshot (`resolveAnchor`: the
 * snapshot's month becomes the start month and its balance the START-of-month
 * value). So the expected/prefilled value for month M must be the same
 * engine's start-of-month value for M — then confirming an untouched row
 * re-anchors at exactly the value the projection already had, and nothing
 * moves. Cash accounts follow the same rule via `MonthlyProjection.startingBalance`.
 *
 * When M lies before the entity's current anchor (a check-in for an older
 * month than the latest snapshot/genesis), the engines have no row for M and
 * the stored value is returned unchanged.
 */

import type {
  YearMonth,
  InvestmentAccount,
  InvestmentContribution,
  Receivable,
  ReceivableRepayment,
  Debt,
  DebtReferenceRate,
  DebtExtraPayment,
  BalanceSnapshot,
} from '@/types';
import { compareYearMonths, resolveAnchor } from './projection';
import {
  calculateInvestmentProjection,
  calculateReceivableProjection,
  calculateDebtAmortization,
} from './wealth-projection';

/** Start-of-month valuation of an investment for `yearMonth`. */
export function expectedInvestmentBalance(
  investment: InvestmentAccount,
  contributions: InvestmentContribution[],
  latestSnapshot: BalanceSnapshot | null | undefined,
  yearMonth: YearMonth
): number {
  const rows = calculateInvestmentProjection(investment, contributions, yearMonth, yearMonth, latestSnapshot);
  const row = rows.find((r) => r.yearMonth === yearMonth);
  return row ? row.startingValuation : (investment.currentValuation ?? investment.startingValuation);
}

/** Start-of-month balance of a receivable for `yearMonth` (0 once repaid). */
export function expectedReceivableBalance(
  receivable: Receivable,
  repayments: ReceivableRepayment[],
  latestSnapshot: BalanceSnapshot | null | undefined,
  yearMonth: YearMonth
): number {
  const anchor = resolveAnchor(receivable.startDate, receivable.initialPrincipal, latestSnapshot);
  if (compareYearMonths(yearMonth, anchor.startMonth) < 0) return receivable.currentBalance;
  const rows = calculateReceivableProjection(receivable, repayments, yearMonth, yearMonth, latestSnapshot);
  const row = rows.find((r) => r.yearMonth === yearMonth);
  // The engine stops emitting rows once the balance reaches 0.
  return row ? row.startingBalance : 0;
}

export interface ExpectedDebtState {
  /** Start-of-month principal (positive). */
  principal: number;
  /** Installments still due from `yearMonth` on (fixed-installment debts only). */
  remainingInstallments?: number;
}

/** Start-of-month principal (and remaining installments) of a debt for `yearMonth`. */
export function expectedDebtState(
  debt: Debt,
  referenceRates: DebtReferenceRate[],
  extraPayments: DebtExtraPayment[],
  latestSnapshot: BalanceSnapshot | null | undefined,
  yearMonth: YearMonth
): ExpectedDebtState {
  const isInstallment = debt.debtType === 'fixed-installment';
  const anchor = resolveAnchor(debt.startDate, debt.initialPrincipal, latestSnapshot, true);
  if (compareYearMonths(yearMonth, anchor.startMonth) < 0) {
    return {
      principal: debt.initialPrincipal,
      ...(isInstallment && debt.remainingInstallments != null ? { remainingInstallments: debt.remainingInstallments } : {}),
    };
  }

  // Rows from the anchor through `yearMonth` (stops early once paid off).
  const rows = calculateDebtAmortization(debt, referenceRates, extraPayments, anchor.startMonth, yearMonth, latestSnapshot);
  const row = rows.find((r) => r.yearMonth === yearMonth);
  const principal = row ? row.startingPrincipal : 0;

  if (!isInstallment) return { principal };

  // Mirror the engine's installment counter: it starts from the reconciled
  // count when anchored on a snapshot, else from the total, and decrements once
  // per projected month while any remain.
  const anchored = !!latestSnapshot && compareYearMonths(latestSnapshot.yearMonth, debt.startDate) >= 0;
  const initialCount = anchored && debt.remainingInstallments != null
    ? debt.remainingInstallments
    : (debt.totalInstallments ?? 0);
  const monthsBefore = rows.filter((r) => compareYearMonths(r.yearMonth, yearMonth) < 0).length;
  return { principal, remainingInstallments: principal > 0 ? Math.max(0, initialCount - monthsBefore) : 0 };
}
