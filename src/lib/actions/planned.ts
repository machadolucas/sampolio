'use server';

import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getAccountById } from '@/lib/db/accounts';
import {
  getPlannedItems as dbGetPlannedItems,
  getPlannedItemById as dbGetPlannedItemById,
  createPlannedItem as dbCreatePlannedItem,
  updatePlannedItem as dbUpdatePlannedItem,
  deletePlannedItem as dbDeletePlannedItem,
} from '@/lib/db/planned-items';
import type { ApiResponse, PlannedItem } from '@/types';

const createPlannedItemSchema = z.object({
  type: z.enum(['income', 'expense']),
  kind: z.enum(['one-off', 'repeating']),
  name: z.string().min(1, 'Name is required'),
  amount: z.number().positive('Amount must be positive'),
  category: z.string().optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  frequency: z.enum(['monthly', 'quarterly', 'yearly', 'custom']).optional(),
  customIntervalMonths: z.number().min(1).optional(),
  firstOccurrence: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
}).refine(
  (data) => {
    if (data.kind === 'one-off') {
      return !!data.scheduledDate;
    }
    return !!data.firstOccurrence && !!data.frequency;
  },
  {
    message: 'One-off items require scheduledDate, repeating items require firstOccurrence and frequency',
  }
);

const updatePlannedItemSchema = z.object({
  type: z.enum(['income', 'expense']).optional(),
  kind: z.enum(['one-off', 'repeating']).optional(),
  name: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  category: z.string().optional().nullable(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  frequency: z.enum(['monthly', 'quarterly', 'yearly', 'custom']).optional(),
  customIntervalMonths: z.number().min(1).optional(),
  firstOccurrence: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
});

export async function getPlannedItems(accountId: string): Promise<ApiResponse<PlannedItem[]>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const items = await dbGetPlannedItems(session.user.id, accountId);
    return { success: true, data: items };
  } catch (error) {
    console.error('Get planned items error:', error);
    return { success: false, error: 'Failed to fetch planned items' };
  }
}

export async function getPlannedItemById(
  accountId: string,
  itemId: string
): Promise<ApiResponse<PlannedItem>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const item = await dbGetPlannedItemById(session.user.id, accountId, itemId);
    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    return { success: true, data: item };
  } catch (error) {
    console.error('Get planned item error:', error);
    return { success: false, error: 'Failed to fetch planned item' };
  }
}

export async function createPlannedItem(
  accountId: string,
  data: z.infer<typeof createPlannedItemSchema>
): Promise<ApiResponse<PlannedItem>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const parsed = createPlannedItemSchema.parse(data);
    const item = await dbCreatePlannedItem(session.user.id, {
      ...parsed,
      accountId,
    });

    return { success: true, data: item };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? 'Validation error' };
    }
    console.error('Create planned item error:', error);
    return { success: false, error: 'Failed to create planned item' };
  }
}

export async function updatePlannedItem(
  accountId: string,
  itemId: string,
  data: z.infer<typeof updatePlannedItemSchema>
): Promise<ApiResponse<PlannedItem>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const parsedData = updatePlannedItemSchema.parse(data);
    const updateData = {
      ...parsedData,
      category: parsedData.category ?? undefined,
      endDate: parsedData.endDate ?? undefined,
    };

    const item = await dbUpdatePlannedItem(session.user.id, accountId, itemId, updateData);
    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    return { success: true, data: item };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? 'Validation error' };
    }
    console.error('Update planned item error:', error);
    return { success: false, error: 'Failed to update planned item' };
  }
}

export async function deletePlannedItem(
  accountId: string,
  itemId: string
): Promise<ApiResponse<null>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    await dbDeletePlannedItem(session.user.id, accountId, itemId);
    return { success: true };
  } catch (error) {
    console.error('Delete planned item error:', error);
    return { success: false, error: 'Failed to delete planned item' };
  }
}
