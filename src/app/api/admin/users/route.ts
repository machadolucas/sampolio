import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getAllUsers, createUser, toPublicUser, findUserById } from '@/lib/db/users';
import type { ApiResponse, PublicUser } from '@/types';

const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.enum(['admin', 'user']),
});

// GET /api/admin/users - List all users
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

    const users = await getAllUsers();
    const publicUsers = users.map(toPublicUser);

    return NextResponse.json<ApiResponse<PublicUser[]>>({
      success: true,
      data: publicUsers,
    });
  } catch (error) {
    console.error('Get users error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

// POST /api/admin/users - Create a new user
export async function POST(request: NextRequest) {
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
    const { email, password, name, role } = createUserSchema.parse(body);

    const user = await createUser(email, password, name, role);

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
    if (error instanceof Error && error.message.includes('already exists')) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: error.message },
        { status: 400 }
      );
    }
    console.error('Create user error:', error);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Failed to create user' },
      { status: 500 }
    );
  }
}
