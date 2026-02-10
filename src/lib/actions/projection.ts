'use server';

import { auth } from '@/lib/auth';
import { cachedGetAccountById, cachedGetRecurringItems, cachedGetPlannedItems } from '@/lib/db/cached';
import { calculateProjection, calculateYearlyRollups, getUniqueCategories } from '@/lib/projection';
import type { ApiResponse, MonthlyProjection, YearlyRollup, ProjectionFilters } from '@/types';

interface ProjectionResponse {
  monthly: MonthlyProjection[];
  yearly: YearlyRollup[];
  categories: string[];
  account: {
    id: string;
    name: string;
    currency: string;
    startingBalance: number;
    startingDate: string;
  };
}

export async function getProjection(
  accountId: string,
  filters?: ProjectionFilters
): Promise<ApiResponse<ProjectionResponse>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await cachedGetAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const [recurringItems, plannedItems] = await Promise.all([
      cachedGetRecurringItems(session.user.id, accountId),
      cachedGetPlannedItems(session.user.id, accountId),
    ]);

    const monthly = calculateProjection(account, recurringItems, plannedItems, filters);
    const yearly = calculateYearlyRollups(monthly);
    const categories = getUniqueCategories(recurringItems, plannedItems);

    return {
      success: true,
      data: {
        monthly,
        yearly,
        categories,
        account: {
          id: account.id,
          name: account.name,
          currency: account.currency,
          startingBalance: account.startingBalance,
          startingDate: account.startingDate,
        },
      },
    };
  } catch (error) {
    console.error('Get projection error:', error);
    return { success: false, error: 'Failed to calculate projection' };
  }
}
