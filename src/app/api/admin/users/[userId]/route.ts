import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { findUserById, updateUser, changePassword, deleteUser, toPublicUser } from '@/lib/db/users';
import type { ApiResponse, PublicUser } from '@/types';

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(['admin', 'user']).optional(),
  isActive: z.boolean().optional(),
});

type Params = Promise<{ userId: string }>;

// GET /api/admin/users/[userId] - Get a specific user
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

    // Check if user is admin
    const currentUser = await findUserById(session.user.id);
    if (!currentUser || currentUser.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const { userId } = await params;
    const user = await findUserById(userId);

    if (!user) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResponse<PublicUser>>({
      success: true,
      data: toPublicUser(user),
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to fetch user' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/users/[userId] - Update a user
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

    // Check if user is admin
    const currentUser = await findUserById(session.user.id);
    if (!currentUser || currentUser.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const { userId } = await params;
    const body = await request.json();
    const data = updateUserSchema.parse(body);

    // Prevent admin from demoting themselves
    if (userId === session.user.id && data.role === 'user') {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'You cannot demote yourself from admin' },
        { status: 400 }
      );
    }

    // Prevent admin from deactivating themselves
    if (userId === session.user.id && data.isActive === false) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'You cannot deactivate your own account' },
        { status: 400 }
      );
    }

    // Handle password change separately
    if (data.password) {
      await changePassword(userId, data.password);
    }

    // Update other fields (exclude password from updates)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...otherUpdates } = data;
    const user = await updateUser(userId, otherUpdates);

    if (!user) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResponse<PublicUser>>({
      success: true,
      data: toPublicUser(user),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: error.issues[0]?.message ?? 'Validation error' },
        { status: 400 }
      );
    }
    console.error('Update user error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to update user' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/users/[userId] - Delete (deactivate) a user
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

    // Check if user is admin
    const currentUser = await findUserById(session.user.id);
    if (!currentUser || currentUser.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const { userId } = await params;

    // Prevent admin from deleting themselves
    if (userId === session.user.id) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'You cannot delete your own account' },
        { status: 400 }
      );
    }

    const success = await deleteUser(userId);

    if (!success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResponse<null>>({
      success: true,
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}
