import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { 
  getAccountById, 
  updateAccount, 
  deleteAccount,
  archiveAccount,
} from '@/lib/db/accounts';
import type { ApiResponse, FinancialAccount } from '@/types';

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  currency: z.enum(['EUR', 'USD', 'BRL', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD']).optional(),
  startingBalance: z.number().optional(),
  startingDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  planningHorizonMonths: z.number().min(1).max(600).optional(),
  customEndDate: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
  isArchived: z.boolean().optional(),
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
    const account = await getAccountById(session.user.id, accountId);
    
    if (!account) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json<ApiResponse<FinancialAccount>>({
      success: true,
      data: account,
    });
  } catch (error) {
    console.error('Get account error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to fetch account' },
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

    const { accountId } = await params;
    const body = await request.json();
    const parsedData = updateAccountSchema.parse(body);
    
    // Transform null values to undefined for type compatibility
    const data = {
      ...parsedData,
      customEndDate: parsedData.customEndDate ?? undefined,
    };
    
    const account = await updateAccount(session.user.id, accountId, data);
    
    if (!account) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json<ApiResponse<FinancialAccount>>({
      success: true,
      data: account,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: error.issues[0]?.message ?? 'Validation error' },
        { status: 400 }
      );
    }
    console.error('Update account error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to update account' },
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

    const { accountId } = await params;
    await deleteAccount(session.user.id, accountId);
    
    return NextResponse.json<ApiResponse<null>>({
      success: true,
    });
  } catch (error) {
    console.error('Delete account error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to delete account' },
      { status: 500 }
    );
  }
}
