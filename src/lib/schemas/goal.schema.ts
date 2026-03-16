import { z } from 'zod';

export const goalSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().or(z.literal('')),
  targetAmount: z.number().positive('Target amount must be positive'),
  currency: z.enum(['EUR', 'USD', 'BRL', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD']),
  targetDate: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal('')),
  trackingMethod: z.enum(['account-balance', 'net-worth', 'manual']),
  linkedAccountId: z.string().optional().or(z.literal('')),
  currentManualAmount: z.number().min(0).optional(),
});

export type GoalFormData = z.infer<typeof goalSchema>;
