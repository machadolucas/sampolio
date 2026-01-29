import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getAccountById } from '@/lib/db/accounts';
import { getSalaryConfigs, createSalaryConfig } from '@/lib/db/salary-configs';
import type { ApiResponse, SalaryConfig } from '@/types';

const createSalaryConfigSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  grossSalary: z.number().positive('Gross salary must be positive'),
  taxRate: z.number().min(0).max(100, 'Tax rate must be between 0 and 100'),
  contributionsRate: z.number().min(0).max(100, 'Contributions rate must be between 0 and 100'),
  otherDeductions: z.number().min(0).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid date format (YYYY-MM)'),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  isActive: z.boolean().optional(),
  isLinkedToRecurring: z.boolean().optional(),
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

    const configs = await getSalaryConfigs(session.user.id, accountId);
    return NextResponse.json<ApiResponse<SalaryConfig[]>>({
      success: true,
      data: configs,
    });
  } catch (error) {
    console.error('Get salary configs error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to fetch salary configs' },
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
    const data = createSalaryConfigSchema.parse(body);
    
    const config = await createSalaryConfig(session.user.id, {
      ...data,
      accountId,
    });
    
    return NextResponse.json<ApiResponse<SalaryConfig>>({
      success: true,
      data: config,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: error.issues[0]?.message ?? 'Validation error' },
        { status: 400 }
      );
    }
    console.error('Create salary config error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to create salary config' },
      { status: 500 }
    );
  }
}
