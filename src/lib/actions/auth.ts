'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { isAPIError } from 'better-auth/api';
import { countUsers } from '@/lib/db/users';
import { isSelfSignupEnabled } from '@/lib/db/app-settings';
import { getAuth } from '@/lib/auth/server';
import { passwordPolicySchema, signUpNameSchema } from '@/lib/schemas/auth.schema';
import type { ApiResponse } from '@/types';

const signUpSchema = z.object({
  email: z.email('Invalid email address').transform(e => e.toLowerCase().trim()),
  password: passwordPolicySchema,
  name: signUpNameSchema,
});

interface SignUpResponse {
  id: string;
  email: string;
  name: string;
  role: string;
}

/**
 * Self sign-up through Better Auth's /sign-up/email. The self-signup setting,
 * first-user-becomes-admin rule and password policy are enforced server-side
 * in the auth hooks (src/lib/auth/server.ts), so a direct POST to the API is
 * gated identically. `nextCookies` sets the session cookie on this action's
 * response, so the new user is signed in when it returns.
 */
export async function signUp(
  data: z.infer<typeof signUpSchema>
): Promise<ApiResponse<SignUpResponse>> {
  try {
    const { email, password, name } = signUpSchema.parse(data);
    const result = await getAuth().api.signUpEmail({
      body: { email, password, name },
      headers: await headers(),
    });
    const user = result.user as typeof result.user & { role?: string };

    return {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role ?? 'user',
      },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? 'Validation error' };
    }
    if (isAPIError(error)) {
      if (error.body?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
        return { success: false, error: 'An account with this email already exists' };
      }
      return { success: false, error: error.body?.message ?? 'Failed to create account' };
    }
    console.error('Sign up error:', error);
    return { success: false, error: 'Failed to create account' };
  }
}

export async function checkSignupEnabled(): Promise<ApiResponse<{ enabled: boolean; isFirstUser: boolean }>> {
  try {
    const isFirstUser = countUsers() === 0;

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
