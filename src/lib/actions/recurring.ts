'use server';

import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getAccountById } from '@/lib/db/accounts';
import {
  getRecurringItems as dbGetRecurringItems,
  getRecurringItemById as dbGetRecurringItemById,
  createRecurringItem as dbCreateRecurringItem,
  updateRecurringItem as dbUpdateRecurringItem,
  deleteRecurringItem as dbDeleteRecurringItem,
} from '@/lib/db/recurring-items';
import type { ApiResponse, RecurringItem } from '@/types';

const createRecurringItemSchema = z.object({
  type: z.enum(['income', 'expense']),
  name: z.string().min(1, 'Name is required'),
  amount: z.number().positive('Amount must be positive'),
  category: z.string().optional(),
  frequency: z.enum(['monthly', 'quarterly', 'yearly', 'custom']),
  customIntervalMonths: z.number().min(1).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid date format (YYYY-MM)'),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  isActive: z.boolean().optional(),
});

const updateRecurringItemSchema = z.object({
  type: z.enum(['income', 'expense']).optional(),
  name: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  category: z.string().optional().nullable(),
  frequency: z.enum(['monthly', 'quarterly', 'yearly', 'custom']).optional(),
  customIntervalMonths: z.number().min(1).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function getRecurringItems(accountId: string): Promise<ApiResponse<RecurringItem[]>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const items = await dbGetRecurringItems(session.user.id, accountId);
    return { success: true, data: items };
  } catch (error) {
    console.error('Get recurring items error:', error);
    return { success: false, error: 'Failed to fetch recurring items' };
  }
}

export async function getRecurringItemById(
  accountId: string,
  itemId: string
): Promise<ApiResponse<RecurringItem>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const item = await dbGetRecurringItemById(session.user.id, accountId, itemId);
    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    return { success: true, data: item };
  } catch (error) {
    console.error('Get recurring item error:', error);
    return { success: false, error: 'Failed to fetch recurring item' };
  }
}

export async function createRecurringItem(
  accountId: string,
  data: z.infer<typeof createRecurringItemSchema>
): Promise<ApiResponse<RecurringItem>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const parsed = createRecurringItemSchema.parse(data);
    const item = await dbCreateRecurringItem(session.user.id, {
      ...parsed,
      accountId,
    });

    return { success: true, data: item };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? 'Validation error' };
    }
    console.error('Create recurring item error:', error);
    return { success: false, error: 'Failed to create recurring item' };
  }
}

export async function updateRecurringItem(
  accountId: string,
  itemId: string,
  data: z.infer<typeof updateRecurringItemSchema>
): Promise<ApiResponse<RecurringItem>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const parsedData = updateRecurringItemSchema.parse(data);
    const updateData = {
      ...parsedData,
      category: parsedData.category ?? undefined,
      endDate: parsedData.endDate ?? undefined,
    };

    const item = await dbUpdateRecurringItem(session.user.id, accountId, itemId, updateData);
    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    return { success: true, data: item };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? 'Validation error' };
    }
    console.error('Update recurring item error:', error);
    return { success: false, error: 'Failed to update recurring item' };
  }
}

export async function deleteRecurringItem(
  accountId: string,
  itemId: string
): Promise<ApiResponse<null>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    await dbDeleteRecurringItem(session.user.id, accountId, itemId);
    return { success: true };
  } catch (error) {
    console.error('Delete recurring item error:', error);
    return { success: false, error: 'Failed to delete recurring item' };
  }
}
