import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getAccountById } from '@/lib/db/accounts';
import { getPlannedItems, createPlannedItem } from '@/lib/db/planned-items';
import type { ApiResponse, PlannedItem } from '@/types';

const createPlannedItemSchema = z.object({
  type: z.enum(['income', 'expense']),
  kind: z.enum(['one-off', 'repeating']),
  name: z.string().min(1, 'Name is required'),
  amount: z.number().positive('Amount must be positive'),
  category: z.string().optional(),
  // For one-off items
  scheduledDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  // For repeating items
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

type Params = Promise<{ accountId: string }>;

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
    
    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }

    const items = await getPlannedItems(session.user.id, accountId);
    return NextResponse.json<ApiResponse<PlannedItem[]>>({
      success: true,
      data: items,
    });
  } catch (error) {
    console.error('Get planned items error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to fetch planned items' },
      { status: 500 }
    );
  }
}

export async function POST(
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
    
    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const data = createPlannedItemSchema.parse(body);
    
    const item = await createPlannedItem(session.user.id, {
      ...data,
      accountId,
    });
    
    return NextResponse.json<ApiResponse<PlannedItem>>({
      success: true,
      data: item,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: error.issues[0]?.message ?? 'Validation error' },
        { status: 400 }
      );
    }
    console.error('Create planned item error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to create planned item' },
      { status: 500 }
    );
  }
}
