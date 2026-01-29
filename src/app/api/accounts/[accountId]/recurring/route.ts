import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getAccountById } from '@/lib/db/accounts';
import { getRecurringItems, createRecurringItem } from '@/lib/db/recurring-items';
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
    
    // Verify account belongs to user
    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }

    const items = await getRecurringItems(session.user.id, accountId);
    return NextResponse.json<ApiResponse<RecurringItem[]>>({
      success: true,
      data: items,
    });
  } catch (error) {
    console.error('Get recurring items error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to fetch recurring items' },
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
    
    // Verify account belongs to user
    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const data = createRecurringItemSchema.parse(body);
    
    const item = await createRecurringItem(session.user.id, {
      ...data,
      accountId,
    });
    
    return NextResponse.json<ApiResponse<RecurringItem>>({
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
    console.error('Create recurring item error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to create recurring item' },
      { status: 500 }
    );
  }
}
