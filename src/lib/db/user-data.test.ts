import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTempDataDir } from '@/test/temp-data-dir';
import { closeDb } from './sqlite/client';
import { createGoal, getGoals } from './goals';
import { createAccount, getAccounts } from './accounts';
import { createRecurringItem, getRecurringItems } from './recurring-items';
import { getUserPreferences, updateUserPreferences } from './user-preferences';
import { createBankConnection, getBankConnections } from './bank-connections';
import { appendBankSyncRun, getBankSyncRuns, getLatestBankSyncRun } from './bank-sync-runs';
import { deleteAllUserData, deleteUserDataGroups } from './user-data';
import type { BankSyncRun } from '@/types';

let tmp: ReturnType<typeof useTempDataDir>;

beforeAll(() => {
  closeDb();
  tmp = useTempDataDir('sampolio-user-data-test-');
});

afterAll(() => {
  closeDb();
  tmp.cleanup();
});

async function seed(userId: string) {
  const account = await createAccount(userId, {
    name: 'Main',
    currency: 'EUR',
    startingBalance: 0,
    startingDate: '2026-01',
    planningHorizonMonths: 12,
  });
  await createRecurringItem(userId, {
    accountId: account.id,
    type: 'expense',
    name: 'Rent',
    amount: 900,
    category: 'Housing',
    frequency: 'monthly',
    startDate: '2026-01',
  });
  await createGoal(userId, { name: 'Buffer', targetAmount: 1000, currency: 'EUR', trackingMethod: 'manual' });
  await createBankConnection(userId, { aspspName: 'Bank', aspspCountry: 'FI' });
  await updateUserPreferences(userId, { hasCompletedOnboarding: true });
  return account;
}

describe('user data groups', () => {
  it('"Start fresh" groups remove the owned data, keep preferences and other users', async () => {
    const alexAccount = await seed('alex');
    await seed('sam');

    deleteUserDataGroups('alex', ['accounts', 'goals', 'bank']);

    expect(await getAccounts('alex')).toEqual([]);
    expect(await getRecurringItems('alex', alexAccount.id)).toEqual([]); // children go with the group
    expect(await getGoals('alex')).toEqual([]);
    expect(await getBankConnections('alex')).toEqual([]);
    expect((await getUserPreferences('alex')).hasCompletedOnboarding).toBe(true);
    expect(await getAccounts('sam')).toHaveLength(1);
    expect(await getGoals('sam')).toHaveLength(1);
  });

  it('a hard delete removes every user-scoped row, preferences included', async () => {
    await seed('kim');
    deleteAllUserData('kim');
    expect(await getAccounts('kim')).toEqual([]);
    expect((await getUserPreferences('kim')).hasCompletedOnboarding).toBe(false);
    expect(await getAccounts('sam')).toHaveLength(1);
  });
});

describe('bank sync runs', () => {
  it('keeps the newest 50, newest first', async () => {
    for (let i = 1; i <= 55; i++) {
      await appendBankSyncRun('alex', 'conn-1', { id: `run-${i}` } as BankSyncRun);
    }
    const runs = await getBankSyncRuns('alex', 'conn-1');
    expect(runs).toHaveLength(50);
    expect(runs[0].id).toBe('run-55');
    expect(runs[49].id).toBe('run-6');
    expect((await getLatestBankSyncRun('alex', 'conn-1'))?.id).toBe('run-55');
  });
});
