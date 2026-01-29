import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getAccountById } from '@/lib/db/accounts';
import { 
  getSalaryConfigById, 
  updateSalaryConfig, 
  deleteSalaryConfig,
} from '@/lib/db/salary-configs';
import type { ApiResponse, SalaryConfig } from '@/types';

const updateSalaryConfigSchema = z.object({
  name: z.string().min(1).optional(),
  grossSalary: z.number().positive().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  contributionsRate: z.number().min(0).max(100).optional(),
  otherDeductions: z.number().min(0).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
  isActive: z.boolean().optional(),
  isLinkedToRecurring: z.boolean().optional(),
});

type Params = Promise<{ accountId: string; configId: string }>;

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

    const { accountId, configId } = await params;
    
    const account = await getAccountById(session.user.id, accountId);
    if (!account) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }

    const config = await getSalaryConfigById(session.user.id, accountId, configId);
    if (!config) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Salary config not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json<ApiResponse<SalaryConfig>>({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('Get salary config error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to fetch salary config' },
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

    const { accountId, configId } = await params;
    const body = await request.json();
    const parsedData = updateSalaryConfigSchema.parse(body);
    
    // Transform null values to undefined for type compatibility
    const data = {
      ...parsedData,
      endDate: parsedData.endDate ?? undefined,
    };
    
    const config = await updateSalaryConfig(session.user.id, accountId, configId, data);
    
    if (!config) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Salary config not found' },
        { status: 404 }
      );
    }
    
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
    console.error('Update salary config error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to update salary config' },
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

    const { accountId, configId } = await params;
    await deleteSalaryConfig(session.user.id, accountId, configId);
    
    return NextResponse.json<ApiResponse<null>>({
      success: true,
    });
  } catch (error) {
    console.error('Delete salary config error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to delete salary config' },
      { status: 500 }
    );
  }
}
