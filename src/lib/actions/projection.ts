'use server';

import { z } from 'zod';
import { auth } from '@/lib/auth';
import { computeAccountProjection } from '@/lib/account-projection';
import { idSchema, yearMonthSchema } from '@/lib/schemas/id.schema';
import type {
  ApiResponse,
  MonthlyProjection,
  ProjectionFilters,
  SalaryConfig,
  TaxedIncome,
} from '@/types';

interface ProjectionResponse {
  monthly: MonthlyProjection[];
  // Past months reconstructed purely from real booked bank transactions (no
  // Sampolio forecast items). Empty unless a bank cash/savings account is linked
  // and has synced data. Rendered to the LEFT of `monthly` on the cashflow page.
  retrospective: MonthlyProjection[];
  categories: string[];
  salaryConfigs: SalaryConfig[];
  // Full taxed-income entities for the selected account — the cashflow page
  // uses them to draw the gross→deductions Sankey for `source: 'taxed-income'`.
  taxedIncomes: TaxedIncome[];
  account: {
    id: string;
    name: string;
    currency: string;
    startingBalance: number;
    startingDate: string;
  };
}

const projectionFiltersSchema = z
  .object({
    startDate: yearMonthSchema.optional(),
    endDate: yearMonthSchema.optional(),
    categories: z.array(z.string().max(200)).max(500).optional(),
    itemTypes: z.array(z.enum(['income', 'expense'])).optional(),
    itemKinds: z.array(z.enum(['recurring', 'one-off', 'repeating'])).optional(),
  })
  .optional();

export async function getProjection(
  accountId: string,
  filters?: ProjectionFilters
): Promise<ApiResponse<ProjectionResponse>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }
    const parsedId = idSchema.safeParse(accountId);
    const parsedFilters = projectionFiltersSchema.safeParse(filters);
    if (!parsedId.success || !parsedFilters.success) {
      return { success: false, error: 'Invalid projection request' };
    }

    const result = await computeAccountProjection(session.user.id, parsedId.data, {
      filters: parsedFilters.data,
      withRetrospective: true,
    });
    if (!result) {
      return { success: false, error: 'Account not found' };
    }
    const { account } = result;

    return {
      success: true,
      data: {
        monthly: result.monthly,
        retrospective: result.retrospective,
        categories: result.categories,
        salaryConfigs: result.salaryConfigs,
        taxedIncomes: result.taxedIncomes,
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
