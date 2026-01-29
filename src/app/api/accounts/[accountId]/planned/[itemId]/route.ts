import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getAccountById } from '@/lib/db/accounts';
import { 
  getPlannedItemById, 
  updatePlannedItem, 
  deletePlannedItem,
} from '@/lib/db/planned-items';
import type { ApiResponse, PlannedItem } from '@/types';

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

type Params = Promise<{ accountId: string; itemId: string }>;

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

    const { accountId, itemId } = await params;
    
    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }

    const item = await getPlannedItemById(session.user.id, accountId, itemId);
    if (!item) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Item not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json<ApiResponse<PlannedItem>>({
      success: true,
      data: item,
    });
  } catch (error) {
    console.error('Get planned item error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to fetch planned item' },
      { status: 500 }
    );
  }
}

export async function PUT(
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

    const { accountId, itemId } = await params;
    const body = await request.json();
    const parsedData = updatePlannedItemSchema.parse(body);
    
    // Transform null values to undefined for type compatibility
    const data = {
      ...parsedData,
      category: parsedData.category ?? undefined,
      endDate: parsedData.endDate ?? undefined,
    };
    
    const item = await updatePlannedItem(session.user.id, accountId, itemId, data);
    
    if (!item) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Item not found' },
        { status: 404 }
      );
    }
    
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
    console.error('Update planned item error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to update planned item' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const { accountId, itemId } = await params;
    await deletePlannedItem(session.user.id, accountId, itemId);
    
    return NextResponse.json<ApiResponse<null>>({
      success: true,
    });
  } catch (error) {
    console.error('Delete planned item error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to delete planned item' },
      { status: 500 }
    );
  }
}
