import { describe, it, expect } from 'vitest';
import { occurrenceOverrideSchema, toOccurrenceOverridePayload } from './occurrence-override.schema';

describe('occurrenceOverrideSchema', () => {
  it('passes with valid data', () => {
    const result = occurrenceOverrideSchema.safeParse({
      name: 'Rent',
      amount: 1200,
      category: 'Housing',
      skipOccurrence: false,
    });
    expect(result.success).toBe(true);
  });

  it('fails when amount is negative', () => {
    const result = occurrenceOverrideSchema.safeParse({
      name: 'Rent',
      amount: -50,
      category: 'Housing',
      skipOccurrence: false,
    });
    expect(result.success).toBe(false);
  });

  it('fails when name is empty', () => {
    const result = occurrenceOverrideSchema.safeParse({
      name: '',
      amount: 100,
      category: '',
      skipOccurrence: false,
    });
    expect(result.success).toBe(false);
  });

  it('passes with zero amount', () => {
    const result = occurrenceOverrideSchema.safeParse({
      name: 'Free month',
      amount: 0,
      category: '',
      skipOccurrence: false,
    });
    expect(result.success).toBe(true);
  });

  it('passes with skipOccurrence set to true', () => {
    const result = occurrenceOverrideSchema.safeParse({
      name: 'Skipped',
      amount: 500,
      category: 'Misc',
      skipOccurrence: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('toOccurrenceOverridePayload', () => {
  it('sends a positive amount as-is', () => {
    expect(toOccurrenceOverridePayload({ name: 'Gym', amount: 25, category: '', skipOccurrence: false })).toEqual({
      name: 'Gym',
      amount: 25,
      category: null,
      skipOccurrence: false,
    });
  });

  it('maps an amount of 0 to a skipped occurrence instead of dropping it', () => {
    const payload = toOccurrenceOverridePayload({ name: 'Gym', amount: 0, category: 'Sports', skipOccurrence: false });
    expect(payload.skipOccurrence).toBe(true);
    expect(payload.amount).toBeUndefined();
    expect(payload.category).toBe('Sports');
  });

  it('keeps the amount when the user skips explicitly', () => {
    const payload = toOccurrenceOverridePayload({ name: 'Gym', amount: 40, category: '', skipOccurrence: true });
    expect(payload).toMatchObject({ amount: 40, skipOccurrence: true });
  });
});
