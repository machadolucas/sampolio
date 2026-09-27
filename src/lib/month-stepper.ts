import type { YearMonth } from '@/types';
import { addMonths, compareYearMonths, MAX_MONTH_ITERATIONS } from '@/lib/projection';

/**
 * A bounded one-month stepper for loops that walk stored months: each call
 * returns the next month, or null once the step would not move forward (a
 * malformed month such as `NaN-NaN`, which `addMonths` returns unchanged) or
 * the loop has taken MAX_MONTH_ITERATIONS steps. Callers `break` on null.
 * Same guard as `getPlannedRepeatingOccurrences` / `generateMonthList`.
 */
export function createMonthStepper(): (from: YearMonth) => YearMonth | null {
  let steps = 0;
  return (from) => {
    const next = addMonths(from, 1);
    if (++steps > MAX_MONTH_ITERATIONS || compareYearMonths(next, from) <= 0) return null;
    return next;
  };
}
