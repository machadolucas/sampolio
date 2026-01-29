import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { 
  getAccounts, 
  createAccount, 
} from '@/lib/db/accounts';
import type { ApiResponse, FinancialAccount } from '@/types';

const createAccountSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  currency: z.enum(['EUR', 'USD', 'BRL', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD']),
  startingBalance: z.number(),
  startingDate: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid date format (YYYY-MM)'),
  planningHorizonMonths: z.number().min(1).max(600),
  customEndDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const accounts = await getAccounts(session.user.id);
    return NextResponse.json<ApiResponse<FinancialAccount[]>>({
      success: true,
      data: accounts,
    });
  } catch (error) {
    console.error('Get accounts error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to fetch accounts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const data = createAccountSchema.parse(body);
    
    const account = await createAccount(session.user.id, data);
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
    console.error('Create account error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to create account' },
      { status: 500 }
    );
  }
}
