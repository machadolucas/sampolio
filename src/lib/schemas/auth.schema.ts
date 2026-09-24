import { z } from 'zod';

/** The one password policy: sign-up, self-service change, and the Better Auth
 * `hooks.before` gate on /sign-up/email and /change-password
 * (src/lib/auth/server.ts) all use it. */
export const passwordPolicySchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[0-9]/, 'Must contain a number')
  .regex(/[^a-zA-Z0-9]/, 'Must contain a special character');

/** Display name rules for self sign-up. */
export const signUpNameSchema = z.string().trim().min(2, 'Name must be at least 2 characters').max(100, 'Name is too long');

export const signInSchema = z.object({
  email: z.email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export type SignInFormData = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.email('Please enter a valid email'),
  password: passwordPolicySchema,
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export type SignUpFormData = z.infer<typeof signUpSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordPolicySchema,
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;
