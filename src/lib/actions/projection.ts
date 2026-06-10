'use server';

import { auth } from '@/lib/auth';
import {
  cachedGetAccountById,
  cachedGetAccountProjectionData,
  cachedGetLatestSnapshot,
  cachedGetMortgagesForUser,
  cachedGetMortgageProjectionData,
  cachedGetBudgets,
} from '@/lib/db/cached';
import { calculateProjection, calculateYearlyRollups, getUniqueCategories, addMonths, type MortgageTransfer, type BudgetTransfer } from '@/lib/projection';
import { calculateMortgageProjection, getMortgageStartDate } from '@/lib/mortgage-projection';
import { computeBudgetTransfers } from '@/lib/budget-utils';
import type { ApiResponse, MonthlyProjection, YearlyRollup, ProjectionFilters, SalaryConfig } from '@/types';

interface ProjectionResponse {
  monthly: MonthlyProjection[];
  yearly: YearlyRollup[];
  categories: string[];
  salaryConfigs: SalaryConfig[];
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

    const [{ recurringItems, plannedItems, salaryConfigs, taxedIncomes }, latestSnapshot] = await Promise.all([
      cachedGetAccountProjectionData(session.user.id, accountId),
      cachedGetLatestSnapshot(session.user.id, 'cash-account', accountId),
    ]);

    // Computed read-only lines: mortgage payments and confirmed budgets linked
    // to this account.
    const [mortgageTransfers, budgetTransfers] = await Promise.all([
      getMortgageTransfersForAccount(session.user.id, accountId),
      getBudgetTransfersForAccount(session.user.id, accountId),
    ]);

    const monthly = calculateProjection(account, recurringItems, plannedItems, taxedIncomes, filters, latestSnapshot, mortgageTransfers, budgetTransfers);
    const yearly = calculateYearlyRollups(monthly);
    const categories = getUniqueCategories(recurringItems, plannedItems);

    return {
      success: true,
      data: {
        monthly,
        yearly,
        categories,
        salaryConfigs,
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

/**
 * Per-month mortgage transfers this user owes from a given cash account. For each
 * shared mortgage where the user's membership links to `accountId`, run the
 * amortization engine and emit the user's `monthlyDeposit` per month. Returns []
 * when no mortgage is linked, so accounts without a mortgage are unaffected.
 */
async function getMortgageTransfersForAccount(userId: string, accountId: string): Promise<MortgageTransfer[]> {
  const transfers: MortgageTransfer[] = [];
  try {
    const mortgages = await cachedGetMortgagesForUser(userId);
    for (const m of mortgages) {
      if (m.isArchived) continue;
      const me = m.members.find((mem) => mem.userId === userId);
      if (!me || me.linkedAccountId !== accountId) continue;

      const inputs = await cachedGetMortgageProjectionData(m.id);
      if (!inputs) continue;
      const genesis = getMortgageStartDate(inputs.mortgage);
      const maxTerm = Math.max(...inputs.mortgage.loans.map((l) => l.originalTermMonths), 12);
      const end = addMonths(genesis, maxTerm + 24);
      const months = calculateMortgageProjection(inputs, end);

      for (const mm of months) {
        const pos = mm.members.find((p) => p.userId === userId);
        if (pos && pos.monthlyDeposit > 0.005) {
          transfers.push({
            yearMonth: mm.yearMonth,
            mortgageId: m.id,
            mortgageName: inputs.mortgage.name,
            amount: pos.monthlyDeposit,
          });
        }
      }
    }
  } catch (error) {
    // A mortgage problem must never break the core cashflow projection.
    console.error('Mortgage transfer injection failed:', error);
  }
  return transfers;
}

/**
 * Per-month flows of the user's confirmed budgets linked to this account
 * (planned costs out, usable funding in), computed by the budget engine.
 * Returns [] when no budget is linked, so other accounts are unaffected.
 */
async function getBudgetTransfersForAccount(userId: string, accountId: string): Promise<BudgetTransfer[]> {
  try {
    const budgets = await cachedGetBudgets(userId);
    return budgets
      .filter(b => b.status === 'confirmed' && !b.isArchived && b.linkedAccountId === accountId)
      .flatMap(b => computeBudgetTransfers(b));
  } catch (error) {
    // A budget problem must never break the core cashflow projection.
    console.error('Budget transfer injection failed:', error);
    return [];
  }
}
