import { describe, expect, it, vi } from 'vitest';

// Positional ids that reach a DB path must come back as ApiResponse errors,
// never as a thrown server action (UnsafePathError / I/O failures).

vi.mock('next/cache', () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'alex-id', email: 'alex@example.com' } })) }));
vi.mock('@/lib/db/cached', () => ({
  cachedGetMortgageById: vi.fn(async () => ({
    id: 'm1',
    name: 'Home loan',
    members: [{ userId: 'alex-id', role: 'owner' }],
    loans: [],
  })),
  cachedGetMortgagesForUser: vi.fn(async () => []),
  cachedGetMortgageProjectionData: vi.fn(async () => null),
  cachedGetMortgageActuals: vi.fn(async () => {
    throw new Error('disk unavailable');
  }),
}));
const dbDeleteRate = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/db/shared-mortgages', () => ({
  deleteRate: dbDeleteRate,
  deleteCost: vi.fn(async () => true),
  deleteExtraPayment: vi.fn(async () => true),
  deleteBalanceSnapshot: vi.fn(async () => true),
  deleteActualsForMonth: vi.fn(async () => 0),
  updateMortgageMember: vi.fn(async () => null),
}));

import {
  deleteMortgageRate,
  deleteMortgageCost,
  deleteMortgageExtraPayment,
  deleteMortgageBalanceSnapshot,
  getMortgageActuals,
  revertMortgageMonth,
  setMyMortgageLinkedAccount,
} from './shared-mortgages';

describe('shared-mortgage actions with positional ids', () => {
  it('reject unsafe sub-entity ids with an ApiResponse error before any I/O', async () => {
    await expect(deleteMortgageRate('m1', '../../x')).resolves.toEqual({ success: false, error: 'Rate not found' });
    await expect(deleteMortgageCost('m1', 'a/b')).resolves.toEqual({ success: false, error: 'Cost not found' });
    await expect(deleteMortgageExtraPayment('m1', '..')).resolves.toEqual({ success: false, error: 'Payment not found' });
    await expect(deleteMortgageBalanceSnapshot('m1', '')).resolves.toEqual({ success: false, error: 'Snapshot not found' });
    await expect(revertMortgageMonth('m1', '2026-13')).resolves.toEqual({ success: false, error: 'Invalid month' });
    await expect(setMyMortgageLinkedAccount('m1', '../acc')).resolves.toEqual({ success: false, error: 'Account not found' });
    expect(dbDeleteRate).not.toHaveBeenCalled();
  });

  it('still deletes with a safe id', async () => {
    await expect(deleteMortgageRate('m1', 'rate-1')).resolves.toEqual({ success: true });
    expect(dbDeleteRate).toHaveBeenCalledWith('m1', 'rate-1');
  });

  it('turns a thrown read into an ApiResponse error', async () => {
    await expect(getMortgageActuals('m1')).resolves.toEqual({ success: false, error: 'Failed to load actuals' });
  });
});
