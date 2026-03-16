import type { Goal, MonthlyProjection, WealthProjectionMonth } from '@/types';

export interface GoalProgress {
  currentAmount: number;
  targetAmount: number;
  percentComplete: number;
  projectedAmountAtTarget: number | null;
  onTrack: boolean;
  projectedDate: string | null;
}

/**
 * Calculate progress toward a financial goal.
 *
 * @param goal - The goal to evaluate
 * @param cashProjections - Map of accountId -> monthly projections (for account-balance goals)
 * @param wealthProjections - Wealth projection months (for net-worth goals)
 */
export function calculateGoalProgress(
  goal: Goal,
  cashProjections?: Map<string, MonthlyProjection[]>,
  wealthProjections?: WealthProjectionMonth[]
): GoalProgress {
  const targetAmount = goal.targetAmount;
  let currentAmount = 0;
  let projectedAmountAtTarget: number | null = null;
  let projectedDate: string | null = null;

  if (goal.trackingMethod === 'account-balance') {
    // Use linked account's projection data
    if (goal.linkedAccountId && cashProjections) {
      const accountProjections = cashProjections.get(goal.linkedAccountId);
      if (accountProjections && accountProjections.length > 0) {
        // Current amount = first month's starting balance
        currentAmount = accountProjections[0].startingBalance;

        // Find projected amount at target date
        if (goal.targetDate) {
          const targetMonth = accountProjections.find(p => p.yearMonth === goal.targetDate);
          if (targetMonth) {
            projectedAmountAtTarget = targetMonth.endingBalance;
          }
        }

        // Find first month where ending balance >= target
        const hitMonth = accountProjections.find(p => p.endingBalance >= targetAmount);
        if (hitMonth) {
          projectedDate = hitMonth.yearMonth;
        }
      }
    }
  } else if (goal.trackingMethod === 'net-worth') {
    // Use wealth projection data
    if (wealthProjections && wealthProjections.length > 0) {
      // Current amount = first month's net worth
      currentAmount = wealthProjections[0].netWorth;

      // Find projected amount at target date
      if (goal.targetDate) {
        const targetMonth = wealthProjections.find(p => p.yearMonth === goal.targetDate);
        if (targetMonth) {
          projectedAmountAtTarget = targetMonth.netWorth;
        }
      }

      // Find first month where net worth >= target
      const hitMonth = wealthProjections.find(p => p.netWorth >= targetAmount);
      if (hitMonth) {
        projectedDate = hitMonth.yearMonth;
      }
    }
  } else {
    // Manual tracking
    currentAmount = goal.currentManualAmount ?? 0;
  }

  const percentComplete = Math.min(100, (currentAmount / targetAmount) * 100);

  let onTrack: boolean;
  if (goal.trackingMethod === 'manual') {
    onTrack = percentComplete >= 100;
  } else {
    onTrack = projectedAmountAtTarget !== null
      ? projectedAmountAtTarget >= targetAmount
      : percentComplete >= 100;
  }

  return {
    currentAmount,
    targetAmount,
    percentComplete,
    projectedAmountAtTarget,
    onTrack,
    projectedDate,
  };
}
