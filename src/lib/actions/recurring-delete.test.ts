import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

// Action-layer test (same harness as goals.test.ts): real auth-guard → db →
// updateTag pipeline with auth() and Next's cache APIs mocked, temp DATA_DIR.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('next/cache', () => ({
  updateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));
vi.mock('@/lib/db/cached', async () => {
  const accounts = await import('@/lib/db/accounts');
  const recurring = await import('@/lib/db/recurring-items');
  return {
    cachedGetAccountById: accounts.getAccountById,
    cachedGetRecurringItems: recurring.getRecurringItems,
    cachedGetRecurringItemById: recurring.getRecurringItemById,
  };
});

import { auth } from '@/lib/auth';
import { updateTag } from 'next/cache';
import { deleteRecurringItem } from './recurring';
import { deleteSalaryConfig } from './salary';
import { createSalaryConfig } from '@/lib/db/salary-configs';
import { createAccount } from '@/lib/db/accounts';
import { createRecurringItem, getRecurringItems } from '@/lib/db/recurring-items';
import { createPlannedItem, getPlannedItems } from '@/lib/db/planned-items';

const mockAuth = vi.mocked(auth);
const userId = 'recurring-delete-test-user';

describe('deleteRecurringItem action', () => {
  let dataDir: string;
  let accountId: string;

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `sampolio-recurring-delete-test-${process.pid}`);
    process.env.DATA_DIR = dataDir;
    const account = await createAccount(userId, {
      name: 'Test account',
      currency: 'EUR',
      startingBalance: 1000,
      startingDate: '2026-01',
      planningHorizonMonths: 12,
    });
    accountId = account.id;
  });

  afterAll(async () => {
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValue({ user: { id: userId } } as any);
  });

  const newRecurring = (name: string) =>
    createRecurringItem(userId, {
      accountId,
      type: 'expense',
      name,
      amount: 50,
      frequency: 'monthly',
      startDate: '2026-01',
    });

  const newOverride = (recurringItemId: string, scheduledDate: string) =>
    createPlannedItem(userId, {
      accountId,
      type: 'expense',
      kind: 'one-off',
      name: 'Override',
      amount: 70,
      scheduledDate,
      linkedRecurringItemId: recurringItemId,
      isRecurringOverride: true,
    });

  it('rejects without a session', async () => {
    mockAuth.mockResolvedValue(null as never);
    expect((await deleteRecurringItem(accountId, 'x')).error).toBe('Unauthorized');
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('deletes the item and only its own occurrence overrides', async () => {
    const doomed = await newRecurring('Gym');
    const kept = await newRecurring('Rent');
    await newOverride(doomed.id, '2026-03');
    await newOverride(doomed.id, '2026-04');
    const keptOverride = await newOverride(kept.id, '2026-03');
    const plainPlanned = await createPlannedItem(userId, {
      accountId,
      type: 'expense',
      kind: 'one-off',
      name: 'Dentist',
      amount: 90,
      scheduledDate: '2026-03',
    });

    const res = await deleteRecurringItem(accountId, doomed.id);
    expect(res.success).toBe(true);

    const recurring = await getRecurringItems(userId, accountId);
    expect(recurring.map(r => r.id)).not.toContain(doomed.id);
    expect(recurring.map(r => r.id)).toContain(kept.id);

    const planned = await getPlannedItems(userId, accountId);
    expect(planned.some(p => p.linkedRecurringItemId === doomed.id)).toBe(false);
    // Other series' overrides and ordinary planned items are untouched.
    expect(planned.map(p => p.id)).toEqual(expect.arrayContaining([keptOverride.id, plainPlanned.id]));

    expect(updateTag).toHaveBeenCalledWith(`user:${userId}:account:${accountId}:recurring`);
    expect(updateTag).toHaveBeenCalledWith(`user:${userId}:account:${accountId}:planned`);
  });

  it('does not invalidate the planned tag when the series had no overrides', async () => {
    const item = await newRecurring('Streaming');
    const res = await deleteRecurringItem(accountId, item.id);
    expect(res.success).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(`user:${userId}:account:${accountId}:recurring`);
    expect(updateTag).not.toHaveBeenCalledWith(`user:${userId}:account:${accountId}:planned`);
  });

  it('deleting a salary also deletes its linked series\' overrides', async () => {
    const salary = await createSalaryConfig(userId, {
      accountId,
      name: 'Alex job',
      grossSalary: 4000,
      taxRate: 20,
      contributionsRate: 8,
      otherDeductions: 0,
      startDate: '2026-01',
      isActive: true,
      isLinkedToRecurring: true,
    });
    expect(salary.linkedRecurringItemId).toBeDefined();
    await newOverride(salary.linkedRecurringItemId!, '2026-05');

    const res = await deleteSalaryConfig(accountId, salary.id);
    expect(res.success).toBe(true);
    const planned = await getPlannedItems(userId, accountId);
    expect(planned.some(p => p.linkedRecurringItemId === salary.linkedRecurringItemId)).toBe(false);
    expect(updateTag).toHaveBeenCalledWith(`user:${userId}:account:${accountId}:planned`);
  });
});
