import { z } from 'zod';

export const plannedItemSchema = z.object({
  type: z.enum(['income', 'expense']),
  kind: z.enum(['one-off', 'repeating']),
  name: z.string().min(1, 'Name is required'),
  amount: z.number().positive('Amount must be positive'),
  category: z.string().optional(),
  // One-off fields
  scheduledDate: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal('')),
  // Repeating fields
  frequency: z.enum(['monthly', 'quarterly', 'yearly', 'custom']).optional(),
  customIntervalMonths: z.number().min(1).optional(),
  firstOccurrence: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal('')),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal('')),
}).refine(
  data => data.kind !== 'one-off' || !!data.scheduledDate,
  { message: 'Scheduled date is required for one-off items', path: ['scheduledDate'] }
).refine(
  data => data.kind !== 'repeating' || !!data.frequency,
  { message: 'Frequency is required for repeating items', path: ['frequency'] }
).refine(
  data => data.kind !== 'repeating' || !!data.firstOccurrence,
  { message: 'First occurrence is required for repeating items', path: ['firstOccurrence'] }
);

export type PlannedItemFormData = z.infer<typeof plannedItemSchema>;
