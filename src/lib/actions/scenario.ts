'use server';

import { z } from 'zod';
import { auth } from '@/lib/auth';
import { cachedGetAccountById, cachedGetAccountProjectionData } from '@/lib/db/cached';
import { calculateProjection } from '@/lib/projection';
import type { ApiResponse, MonthlyProjection, RecurringItem, PlannedItem } from '@/types';

const scenarioModSchema = z.object({
  type: z.enum(['add-income', 'add-expense', 'remove-item', 'modify-amount']),
  name: z.string().optional(),
  amount: z.number().optional(),
  frequency: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
  itemId: z.string().optional(), // for remove/modify
  newAmount: z.number().optional(), // for modify
});

const runScenarioSchema = z.object({
  accountId: z.string().min(1),
  modifications: z.array(scenarioModSchema).min(1),
});

interface ScenarioResult {
  current: MonthlyProjection[];
  modified: MonthlyProjection[];
  summary: {
    currentEndBalance: number;
    modifiedEndBalance: number;
    difference: number;
    monthsProjected: number;
  };
}

export async function runScenarioProjection(
  accountId: string,
  modifications: Array<{
    type: 'add-income' | 'add-expense' | 'remove-item' | 'modify-amount';
    name?: string;
    amount?: number;
    frequency?: 'monthly' | 'quarterly' | 'yearly';
    itemId?: string;
    newAmount?: number;
  }>
): Promise<ApiResponse<ScenarioResult>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const parsed = runScenarioSchema.safeParse({ accountId, modifications });
    if (!parsed.success) {
      return { success: false, error: 'Invalid scenario input' };
    }

    const account = await cachedGetAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const { recurringItems, plannedItems, taxedIncomes } = await cachedGetAccountProjectionData(
      session.user.id,
      accountId
    );

    // Calculate current projection
    const current = calculateProjection(account, recurringItems, plannedItems, taxedIncomes);

    // Clone and modify items for the scenario
    let modifiedRecurring = [...recurringItems];
    let modifiedPlanned = [...plannedItems];

    const now = new Date();
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (const mod of modifications) {
      switch (mod.type) {
        case 'add-income':
        case 'add-expense': {
          const newItem: RecurringItem = {
            id: `scenario-${Date.now()}-${Math.random()}`,
            accountId,
            type: mod.type === 'add-income' ? 'income' : 'expense',
            name: mod.name || (mod.type === 'add-income' ? 'New Income' : 'New Expense'),
            amount: mod.amount || 0,
            frequency: mod.frequency || 'monthly',
            startDate,
            isActive: true,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          };
          modifiedRecurring = [...modifiedRecurring, newItem];
          break;
        }
        case 'remove-item': {
          if (mod.itemId) {
            modifiedRecurring = modifiedRecurring.filter(r => r.id !== mod.itemId);
            modifiedPlanned = modifiedPlanned.filter(p => p.id !== mod.itemId);
          }
          break;
        }
        case 'modify-amount': {
          if (mod.itemId && mod.newAmount !== undefined) {
            modifiedRecurring = modifiedRecurring.map(r =>
              r.id === mod.itemId ? { ...r, amount: mod.newAmount! } : r
            );
          }
          break;
        }
      }
    }

    // Calculate modified projection
    const modified = calculateProjection(account, modifiedRecurring, modifiedPlanned, taxedIncomes);

    const currentEnd = current[current.length - 1];
    const modifiedEnd = modified[modified.length - 1];

    return {
      success: true,
      data: {
        current,
        modified,
        summary: {
          currentEndBalance: currentEnd?.endingBalance ?? account.startingBalance,
          modifiedEndBalance: modifiedEnd?.endingBalance ?? account.startingBalance,
          difference: (modifiedEnd?.endingBalance ?? 0) - (currentEnd?.endingBalance ?? 0),
          monthsProjected: current.length,
        },
      },
    };
  } catch (error) {
    console.error('Scenario projection error:', error);
    return { success: false, error: 'Failed to run scenario' };
  }
}
