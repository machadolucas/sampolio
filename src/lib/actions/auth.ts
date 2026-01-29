'use server';

import { z } from 'zod';
import { createUser, findUserByEmail, getAllUsers } from '@/lib/db/users';
import { isSelfSignupEnabled } from '@/lib/db/app-settings';
import type { ApiResponse } from '@/types';

const signUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
});

interface SignUpResponse {
  id: string;
  email: string;
  name: string;
  role: string;
}

export async function signUp(
  data: z.infer<typeof signUpSchema>
): Promise<ApiResponse<SignUpResponse>> {
  try {
    const { email, password, name } = signUpSchema.parse(data);

    // Check if this is the first user (always allow first user signup)
    const allUsers = await getAllUsers();
    const isFirstUser = allUsers.length === 0;

    // Check if self-signup is enabled (unless first user)
    if (!isFirstUser) {
      const selfSignupEnabled = await isSelfSignupEnabled();
      if (!selfSignupEnabled) {
        return {
          success: false,
          error: 'Self-signup is currently disabled. Please contact an administrator.',
        };
      }
    }

    // Check if user already exists
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return { success: false, error: 'An account with this email already exists' };
    }

    // Create the user
    const user = await createUser(email, password, name);

    return {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? 'Validation error' };
    }
    console.error('Sign up error:', error);
    return { success: false, error: 'Failed to create account' };
  }
}

export async function checkSignupEnabled(): Promise<ApiResponse<{ enabled: boolean; isFirstUser: boolean }>> {
  try {
    const allUsers = await getAllUsers();
    const isFirstUser = allUsers.length === 0;
    
    if (isFirstUser) {
      return { success: true, data: { enabled: true, isFirstUser: true } };
    }
    
    const selfSignupEnabled = await isSelfSignupEnabled();
    return { success: true, data: { enabled: selfSignupEnabled, isFirstUser: false } };
  } catch (error) {
    console.error('Check signup enabled error:', error);
    return { success: false, error: 'Failed to check signup status' };
  }
}
