'use server';

import { z } from 'zod';
import { auth } from '@/lib/auth';
import { cachedGetAccountById, cachedGetTaxedIncomes, cachedGetTaxedIncomeById } from '@/lib/db/cached';
import {
  createTaxedIncome as dbCreateTaxedIncome,
  updateTaxedIncome as dbUpdateTaxedIncome,
  deleteTaxedIncome as dbDeleteTaxedIncome,
} from '@/lib/db/taxed-income';
import { updateTag } from 'next/cache';
import { clearNullsInPatch } from '@/lib/patch-utils';
import type { ApiResponse, TaxedIncome } from '@/types';

const createTaxedIncomeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  grossAmount: z.number().positive('Gross amount must be positive'),
  useSalaryTaxSettings: z.boolean().optional(),
  customTaxRate: z.number().min(0).max(100).optional(),
  customContributionsRate: z.number().min(0).max(100).optional(),
  customOtherDeductions: z.number().min(0).optional(),
  kind: z.enum(['one-off', 'recurring']),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  frequency: z.enum(['monthly', 'quarterly', 'yearly', 'custom']).optional(),
  customIntervalMonths: z.number().positive().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  skippedOccurrences: z.array(z.string().regex(/^\d{4}-\d{2}$/)).optional(),
  isActive: z.boolean().optional(),
});

// Optional fields accept `null` as the explicit "clear" signal (an undefined
// key is dropped in transit); an absent key keeps the stored value.
const updateTaxedIncomeSchema = createTaxedIncomeSchema.partial().extend({
  customTaxRate: z.number().min(0).max(100).optional().nullable(),
  customContributionsRate: z.number().min(0).max(100).optional().nullable(),
  customOtherDeductions: z.number().min(0).optional().nullable(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
  frequency: z.enum(['monthly', 'quarterly', 'yearly', 'custom']).optional().nullable(),
  customIntervalMonths: z.number().positive().optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
});

const TAXED_INCOME_CLEARABLE_KEYS = [
  'customTaxRate',
  'customContributionsRate',
  'customOtherDeductions',
  'scheduledDate',
  'frequency',
  'customIntervalMonths',
  'startDate',
  'endDate',
] as const;

// ============================================================
// TAXED INCOME ACTIONS
// ============================================================

export async function getTaxedIncomes(accountId: string): Promise<ApiResponse<TaxedIncome[]>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await cachedGetAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const incomes = await cachedGetTaxedIncomes(session.user.id, accountId);
    return { success: true, data: incomes };
  } catch (error) {
    console.error('Get taxed incomes error:', error);
    return { success: false, error: 'Failed to fetch taxed incomes' };
  }
}

export async function getTaxedIncomeById(
  accountId: string,
  incomeId: string
): Promise<ApiResponse<TaxedIncome>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await cachedGetAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const income = await cachedGetTaxedIncomeById(session.user.id, accountId, incomeId);
    if (!income) {
      return { success: false, error: 'Taxed income not found' };
    }

    return { success: true, data: income };
  } catch (error) {
    console.error('Get taxed income error:', error);
    return { success: false, error: 'Failed to fetch taxed income' };
  }
}

export async function createTaxedIncome(
  accountId: string,
  data: z.infer<typeof createTaxedIncomeSchema>
): Promise<ApiResponse<TaxedIncome>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await cachedGetAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const validated = createTaxedIncomeSchema.parse(data);
    const income = await dbCreateTaxedIncome(session.user.id, accountId, {
      ...validated,
      accountId,
    });

    updateTag(`user:${session.user.id}:account:${accountId}:taxed-income`);
    return { success: true, data: income };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? 'Validation error' };
    }
    console.error('Create taxed income error:', error);
    return { success: false, error: 'Failed to create taxed income' };
  }
}

export async function updateTaxedIncome(
  accountId: string,
  incomeId: string,
  data: z.infer<typeof updateTaxedIncomeSchema>
): Promise<ApiResponse<TaxedIncome>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await cachedGetAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const validated = updateTaxedIncomeSchema.parse(data);
    // Only keys the caller sent are touched; `null` clears the field.
    const updateData = clearNullsInPatch(validated, TAXED_INCOME_CLEARABLE_KEYS);
    const income = await dbUpdateTaxedIncome(session.user.id, accountId, incomeId, updateData);

    if (!income) {
      return { success: false, error: 'Taxed income not found' };
    }

    updateTag(`user:${session.user.id}:account:${accountId}:taxed-income`);
    return { success: true, data: income };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? 'Validation error' };
    }
    console.error('Update taxed income error:', error);
    return { success: false, error: 'Failed to update taxed income' };
  }
}

export async function deleteTaxedIncome(
  accountId: string,
  incomeId: string
): Promise<ApiResponse<void>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await cachedGetAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    await dbDeleteTaxedIncome(session.user.id, accountId, incomeId);
    updateTag(`user:${session.user.id}:account:${accountId}:taxed-income`);
    return { success: true };
  } catch (error) {
    console.error('Delete taxed income error:', error);
    return { success: false, error: 'Failed to delete taxed income' };
  }
}
