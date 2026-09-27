import { z } from 'zod';

export const occurrenceOverrideSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  // 0 is accepted in the form but saved as a skipped occurrence — the server
  // override schema requires a positive amount (see toOccurrenceOverridePayload).
  amount: z.number().min(0, 'Amount cannot be negative'),
  category: z.string(),
  skipOccurrence: z.boolean(),
});

export type OccurrenceOverrideFormData = z.infer<typeof occurrenceOverrideSchema>;

/** Payload for `upsertRecurringItemOccurrenceOverride`. */
export interface OccurrenceOverridePayload {
  name?: string;
  amount?: number;
  category: string | null;
  skipOccurrence: boolean;
}

/**
 * Map the override form to the server payload. An amount of 0 means "nothing
 * happens this month", which is exactly a skipped occurrence; the server only
 * accepts positive override amounts, so 0 becomes `skipOccurrence: true`
 * instead of being silently dropped. Any positive amount is always sent.
 */
export function toOccurrenceOverridePayload(formData: OccurrenceOverrideFormData): OccurrenceOverridePayload {
  const hasAmount = typeof formData.amount === 'number' && formData.amount > 0;
  return {
    name: formData.name || undefined,
    amount: hasAmount ? formData.amount : undefined,
    category: formData.category || null,
    skipOccurrence: formData.skipOccurrence || !hasAmount,
  };
}
