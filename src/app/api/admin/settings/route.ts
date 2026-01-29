import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { findUserById } from '@/lib/db/users';
import { getAppSettings, updateAppSettings } from '@/lib/db/app-settings';
import type { ApiResponse, AppSettings } from '@/types';

const updateSettingsSchema = z.object({
  selfSignupEnabled: z.boolean().optional(),
});

// GET /api/admin/settings - Get app settings
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is admin
    const currentUser = await findUserById(session.user.id);
    if (!currentUser || currentUser.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const settings = await getAppSettings();

    return NextResponse.json<ApiResponse<AppSettings>>({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error('Get settings error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/settings - Update app settings
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is admin
    const currentUser = await findUserById(session.user.id);
    if (!currentUser || currentUser.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const data = updateSettingsSchema.parse(body);

    const settings = await updateAppSettings(data, session.user.id);

    return NextResponse.json<ApiResponse<AppSettings>>({
      success: true,
      data: settings,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: error.issues[0]?.message ?? 'Validation error' },
        { status: 400 }
      );
    }
    console.error('Update settings error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
