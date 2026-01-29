import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getAccountById } from '@/lib/db/accounts';
import { getRecurringItems } from '@/lib/db/recurring-items';
import { getPlannedItems } from '@/lib/db/planned-items';
import { calculateProjection, calculateYearlyRollups, getUniqueCategories } from '@/lib/projection';
import type { ApiResponse, MonthlyProjection, YearlyRollup, ProjectionFilters } from '@/types';

const projectionFiltersSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  categories: z.array(z.string()).optional(),
  itemTypes: z.array(z.enum(['income', 'expense'])).optional(),
  itemKinds: z.array(z.enum(['recurring', 'one-off', 'repeating'])).optional(),
  view: z.enum(['monthly', 'yearly']).optional(),
});

type Params = Promise<{ accountId: string }>;

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

export async function GET(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { accountId } = await params;
    const { searchParams } = new URL(request.url);
    
    // Parse filter parameters
    const filters: ProjectionFilters = {};
    if (searchParams.get('startDate')) {
      filters.startDate = searchParams.get('startDate')!;
    }
    if (searchParams.get('endDate')) {
      filters.endDate = searchParams.get('endDate')!;
    }
    if (searchParams.get('categories')) {
      filters.categories = searchParams.get('categories')!.split(',');
    }
    if (searchParams.get('itemTypes')) {
      filters.itemTypes = searchParams.get('itemTypes')!.split(',') as ('income' | 'expense')[];
    }
    if (searchParams.get('itemKinds')) {
      filters.itemKinds = searchParams.get('itemKinds')!.split(',') as ('recurring' | 'one-off' | 'repeating')[];
    }
    
    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }

    const [recurringItems, plannedItems] = await Promise.all([
      getRecurringItems(session.user.id, accountId),
      getPlannedItems(session.user.id, accountId),
    ]);

    const monthly = calculateProjection(account, recurringItems, plannedItems, filters);
    const yearly = calculateYearlyRollups(monthly);
    const categories = getUniqueCategories(recurringItems, plannedItems);

    return NextResponse.json<ApiResponse<ProjectionResponse>>({
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
    });
  } catch (error) {
    console.error('Get projection error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to calculate projection' },
      { status: 500 }
    );
  }
}
