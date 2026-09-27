/**
 * Pure derivations for the Overview hero card and the Net Worth KPI's
 * month-over-month badge.
 *
 * The wealth projection starts at the CURRENT month, so it never holds a
 * previous month — comparing against it always produced a fake €0 delta
 * ("balanced this month", "▲ €0,00 vs last month", "unchanged vs last month").
 * The hero now reads the per-account cash projections directly, and every
 * comparison is `null` (render nothing) when there is no real previous-month
 * data.
 */

import { addMonths } from '@/lib/projection';
import type { MonthlyProjection, WealthProjectionMonth, YearMonth } from '@/types';

export interface HeroSummary {
  /**
   * This month's whole-month net for all active cash accounts. For a normal
   * forecast row that is its `netChange`; for a row actualized from bank data
   * `netChange` only holds what is still to come ("Net left"), so the whole
   * month is `endingBalance − openingBalance` (booked so far + remaining), or
   * the planned totals when the opening is unknown.
   */
  netChange: number;
  /** Σ current-month income (drives the "caution" sentiment). */
  totalIncome: number;
  /** Projected end-of-month cash across the active accounts. */
  endBalance: number;
  /**
   * End-of-month cash vs the previous month's ending cash, or null when any
   * account lacks a previous-month row (forecast or bank retrospective).
   */
  trend: number | null;
}

export interface HeroInputs {
  accountIds: string[];
  cashProjections: Record<string, { monthly: MonthlyProjection[]; retrospective?: MonthlyProjection[] }>;
  currentYearMonth: YearMonth;
  /**
   * The wealth projection's current-month cash total, preferred for
   * `endBalance` because it applies the engine's coverage fallbacks.
   */
  wealthCurrentMonth?: Pick<WealthProjectionMonth, 'cashAccountsTotal'>;
}

/** Returns null when no account has a current-month projection row. */
export function deriveHeroSummary({ accountIds, cashProjections, currentYearMonth, wealthCurrentMonth }: HeroInputs): HeroSummary | null {
  const prevYearMonth = addMonths(currentYearMonth, -1);
  let netChange = 0;
  let totalIncome = 0;
  let rowsEnd = 0;
  let prevEnd = 0;
  let found = 0;
  let comparable = accountIds.length > 0;

  for (const id of accountIds) {
    const slice = cashProjections[id];
    const current = slice?.monthly.find((m) => m.yearMonth === currentYearMonth);
    const previous =
      slice?.monthly.find((m) => m.yearMonth === prevYearMonth) ??
      slice?.retrospective?.find((m) => m.yearMonth === prevYearMonth);
    if (current) {
      found++;
      const monthIncome = current.isActualized ? (current.plannedTotalIncome ?? current.totalIncome) : current.totalIncome;
      const monthExpenses = current.isActualized ? (current.plannedTotalExpenses ?? current.totalExpenses) : current.totalExpenses;
      // Actualized row: booked activity so far + what is still to come, i.e.
      // ending − month-start balance (openingBalance). Planned totals only
      // when the opening is unknown.
      netChange += !current.isActualized
        ? current.netChange
        : current.openingBalance !== undefined
          ? current.endingBalance - current.openingBalance
          : monthIncome - monthExpenses;
      totalIncome += monthIncome;
      rowsEnd += current.endingBalance;
    }
    if (current && previous) prevEnd += previous.endingBalance;
    else comparable = false;
  }

  if (found === 0) return null;
  return {
    netChange,
    totalIncome,
    endBalance: wealthCurrentMonth?.cashAccountsTotal ?? rowsEnd,
    // Compare like with like: only when every account has both rows.
    trend: comparable ? rowsEnd - prevEnd : null,
  };
}

/** True when a money delta would render as zero (rounds to 0 cents). */
export function isZeroMoney(value: number): boolean {
  return Math.round(value * 100) === 0;
}

/**
 * Net worth change vs last month from the wealth projection, or `undefined`
 * (badge hidden) when the projection has no previous-month row — which is
 * always the case today since it starts at the current month.
 */
export function netWorthChangeVsLastMonth(
  projection: Pick<WealthProjectionMonth, 'yearMonth' | 'netWorth'>[],
  currentYearMonth: YearMonth,
  currentNetWorth: number
): number | undefined {
  const prevYearMonth = addMonths(currentYearMonth, -1);
  const prev = projection.find((p) => p.yearMonth === prevYearMonth);
  return prev ? currentNetWorth - prev.netWorth : undefined;
}
