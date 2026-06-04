/**
 * Pure, client-safe mortgage helpers (no server / DB imports).
 * The ownership-share derivation and the yearly Euribor-due detection live here
 * so the setup wizard, panels, and charts share one source of truth.
 */

import type { SharedMortgage, MortgageRateEntry, YearMonth } from '@/types';
import { compareYearMonths } from './projection';

/**
 * Derive each member's ongoing loan share from their down payments and target.
 *
 * The member who paid LESS up front still owes MORE of their target stake, so
 * they carry a larger share of the monthly loan — which is exactly what pulls
 * both members toward their target ownership over time.
 *
 *   remainingToTarget_m = targetPercent_m * housePrice − initialPayment_m
 *   share_m             = remainingToTarget_m / Σ remainingToTarget
 *
 * With a €328k home, equal 50% targets, and €31k / €4k down payments this yields
 * the spreadsheet's 45.4% / 54.6% split.
 *
 * @param targetPercents per-member target ownership fraction (should sum to 1).
 */
export function deriveLoanShares(
  housePrice: number,
  initialPayments: number[],
  targetPercents: number[]
): number[] {
  const remaining = initialPayments.map((p, i) => Math.max(0, (targetPercents[i] ?? 1 / initialPayments.length) * housePrice - p));
  const sum = remaining.reduce((s, r) => s + r, 0);
  if (sum <= 0) {
    // Everyone already at/over target — split evenly.
    return initialPayments.map(() => 1 / initialPayments.length);
  }
  return remaining.map((r) => r / sum);
}

export interface EuriborDueInfo {
  due: boolean;
  /** The most recent reset anchor date on or before today. */
  lastResetDate: Date;
  /** The next reset date in the future. */
  nextResetDate: Date;
  /** Whole days until the next reset (negative if it just passed). */
  daysUntilNext: number;
  /** The YYYY-MM the current reset cycle belongs to (what a new rate entry should target). */
  resetYearMonth: YearMonth;
}

function resetDateInYear(year: number, month: number, day: number): Date {
  const clampedDay = Math.min(day, new Date(year, month, 0).getDate());
  return new Date(year, month - 1, clampedDay);
}

function toYearMonth(d: Date): YearMonth {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Whether it's time to enter this year's Euribor rate. "Due" means we're inside a
 * window around the reset date (a week before, up to ~60 days after) AND no rate
 * entry has been recorded for the current reset cycle yet — so the banner appears
 * once a year and disappears the moment the user enters the new rate.
 */
export function isEuriborUpdateDue(
  mortgage: Pick<SharedMortgage, 'rateResetMonth' | 'rateResetDay'>,
  rates: MortgageRateEntry[],
  now: Date = new Date()
): EuriborDueInfo {
  const { rateResetMonth, rateResetDay } = mortgage;
  const thisYearReset = resetDateInYear(now.getFullYear(), rateResetMonth, rateResetDay);

  const lastResetDate =
    now >= thisYearReset
      ? thisYearReset
      : resetDateInYear(now.getFullYear() - 1, rateResetMonth, rateResetDay);
  const nextResetDate =
    now >= thisYearReset
      ? resetDateInYear(now.getFullYear() + 1, rateResetMonth, rateResetDay)
      : thisYearReset;

  const resetYearMonth = toYearMonth(lastResetDate);
  const MS_PER_DAY = 86_400_000;
  const daysUntilNext = Math.ceil((nextResetDate.getTime() - now.getTime()) / MS_PER_DAY);
  const daysSinceLast = Math.floor((now.getTime() - lastResetDate.getTime()) / MS_PER_DAY);

  // Has the current cycle's rate already been entered?
  const hasCurrentCycleRate = rates.some(
    (r) => compareYearMonths(r.effectiveDate, resetYearMonth) >= 0
  );

  const withinWindow = (daysUntilNext <= 7 || (daysSinceLast >= 0 && daysSinceLast <= 60));
  const due = withinWindow && !hasCurrentCycleRate;

  return { due, lastResetDate, nextResetDate, daysUntilNext, resetYearMonth };
}
