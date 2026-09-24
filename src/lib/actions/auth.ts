'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { isAPIError } from 'better-auth/api';
import { isAuthSetupComplete, isFirstUserSetup } from '@/lib/db/sqlite/legacy-import';
import { isSelfSignupEnabled } from '@/lib/db/app-settings';
import { getAuth } from '@/lib/auth/server';
import { passwordPolicySchema, signUpNameSchema } from '@/lib/schemas/auth.schema';
import { clientIpFrom, consumeRateLimit } from '@/lib/rate-limit';
import type { ApiResponse } from '@/types';

const signUpSchema = z.object({
  email: z.email('Invalid email address').transform(e => e.toLowerCase().trim()),
  password: passwordPolicySchema,
  name: signUpNameSchema,
});

// auth.api.signUpEmail bypasses Better Auth's HTTP rate limiter, so the
// action enforces its own: per client IP, plus a global ceiling.
const SIGNUP_LIMIT_PER_IP = { max: 5, windowMs: 10 * 60 * 1000 };
const SIGNUP_LIMIT_GLOBAL = { max: 30, windowMs: 60 * 60 * 1000 };

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
    const requestHeaders = await headers();
    const perIp = consumeRateLimit(`signup:ip:${clientIpFrom(requestHeaders)}`, SIGNUP_LIMIT_PER_IP.max, SIGNUP_LIMIT_PER_IP.windowMs);
    const global = perIp.allowed
      ? consumeRateLimit('signup:global', SIGNUP_LIMIT_GLOBAL.max, SIGNUP_LIMIT_GLOBAL.windowMs)
      : perIp;
    if (!global.allowed) {
      return {
        success: false,
        error: `Too many sign-up attempts. Try again in ${Math.ceil(global.retryAfter / 60)} min.`,
      };
    }
    const result = await getAuth().api.signUpEmail({
      body: { email, password, name },
      headers: requestHeaders,
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
    if (!isAuthSetupComplete()) {
      return { success: true, data: { enabled: false, isFirstUser: false } };
    }
    const isFirstUser = isFirstUserSetup();

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
