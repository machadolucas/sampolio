import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

// Action-layer tests for partial ("patch") updates: a toggle-only patch must
// not clear unrelated optional fields, and `null` must still clear a field
// explicitly. Same harness as goals.test.ts — auth() and Next's cache APIs are
// mocked, the db writes to a temp DATA_DIR.
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
    cachedGetRecurringItemById: recurring.getRecurringItemById,
  };
});

import { auth } from '@/lib/auth';
import { updateTag } from 'next/cache';
import { updateRecurringItem } from './recurring';
import { updatePlannedItem } from './planned';
import { createSalaryConfig, updateSalaryConfig, deleteSalaryConfig } from './salary';
import { updateAccount } from './accounts';
import { createAccount, getAccountById } from '@/lib/db/accounts';
import { createRecurringItem, getRecurringItemById } from '@/lib/db/recurring-items';
import { createPlannedItem } from '@/lib/db/planned-items';

const mockAuth = vi.mocked(auth);
const userId = 'partial-update-test-user';

describe('partial update actions preserve fields that were not sent', () => {
  let dataDir: string;
  let accountId: string;

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `sampolio-partial-update-test-${process.pid}`);
    process.env.DATA_DIR = dataDir;
    const account = await createAccount(userId, {
      name: 'Alex main',
      currency: 'EUR',
      startingBalance: 1000,
      startingDate: '2026-01',
      planningHorizonMonths: -1,
      customEndDate: '2030-12',
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

  it('recurring: an isActive toggle keeps endDate, category and the card link', async () => {
    const item = await createRecurringItem(userId, {
      accountId,
      type: 'expense',
      name: 'Gym',
      amount: 40,
      category: 'Sports',
      frequency: 'monthly',
      startDate: '2026-01',
      endDate: '2026-12',
      paidByCardLinkId: 'card-link-1',
      isActive: true,
    });

    const off = await updateRecurringItem(accountId, item.id, { isActive: false });
    expect(off.success).toBe(true);
    const on = await updateRecurringItem(accountId, item.id, { isActive: true });
    expect(on.success).toBe(true);

    const stored = await getRecurringItemById(userId, accountId, item.id);
    expect(stored).toMatchObject({
      isActive: true,
      endDate: '2026-12',
      category: 'Sports',
      paidByCardLinkId: 'card-link-1',
    });
  });

  it('recurring: an explicit null still clears only that field', async () => {
    const item = await createRecurringItem(userId, {
      accountId,
      type: 'expense',
      name: 'Streaming',
      amount: 12,
      category: 'Entertainment',
      frequency: 'monthly',
      startDate: '2026-01',
      endDate: '2026-06',
      paidByCardLinkId: 'card-link-1',
    });

    const res = await updateRecurringItem(accountId, item.id, { endDate: null, paidByCardLinkId: null });
    expect(res.success).toBe(true);
    const stored = await getRecurringItemById(userId, accountId, item.id);
    expect(stored?.endDate).toBeUndefined();
    expect(stored?.paidByCardLinkId).toBeUndefined();
    expect(stored?.category).toBe('Entertainment');
  });

  it('planned: an amount-only patch keeps category, endDate and the card link', async () => {
    const item = await createPlannedItem(userId, {
      accountId,
      type: 'expense',
      kind: 'repeating',
      name: 'Insurance',
      amount: 300,
      category: 'Insurance',
      frequency: 'yearly',
      firstOccurrence: '2026-03',
      endDate: '2029-03',
      paidByCardLinkId: 'card-link-1',
    });

    const res = await updatePlannedItem(accountId, item.id, { amount: 320 });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({
      amount: 320,
      category: 'Insurance',
      endDate: '2029-03',
      paidByCardLinkId: 'card-link-1',
    });
  });

  it('salary: an isActive toggle keeps the end date on the config and its linked recurring item', async () => {
    const created = await createSalaryConfig(accountId, {
      name: 'Alex job',
      grossSalary: 4000,
      taxRate: 20,
      contributionsRate: 8,
      startDate: '2026-01',
      endDate: '2027-06',
      isActive: true,
      isLinkedToRecurring: true,
    });
    expect(created.success).toBe(true);
    const config = created.data!;
    expect(config.linkedRecurringItemId).toBeDefined();
    expect(updateTag).toHaveBeenCalledWith(`user:${userId}:account:${accountId}:recurring`);

    vi.mocked(updateTag).mockClear();
    const res = await updateSalaryConfig(accountId, config.id, { isActive: false });
    expect(res.success).toBe(true);
    expect(res.data?.endDate).toBe('2027-06');
    expect(updateTag).toHaveBeenCalledWith(`user:${userId}:account:${accountId}:recurring`);

    const linked = await getRecurringItemById(userId, accountId, config.linkedRecurringItemId!);
    expect(linked).toMatchObject({ isActive: false, endDate: '2027-06' });

    vi.mocked(updateTag).mockClear();
    const del = await deleteSalaryConfig(accountId, config.id);
    expect(del.success).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(`user:${userId}:account:${accountId}:recurring`);
  });

  it('account: archiving keeps the custom end date', async () => {
    const res = await updateAccount(accountId, { isArchived: true });
    expect(res.success).toBe(true);
    const stored = await getAccountById(userId, accountId);
    expect(stored).toMatchObject({ isArchived: true, customEndDate: '2030-12' });

    const cleared = await updateAccount(accountId, { isArchived: false, customEndDate: null });
    expect(cleared.success).toBe(true);
    expect((await getAccountById(userId, accountId))?.customEndDate).toBeUndefined();
  });
});
