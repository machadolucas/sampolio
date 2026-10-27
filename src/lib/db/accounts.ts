import { v4 as uuidv4 } from 'uuid';
import type { FinancialAccount, CreateAccountRequest, UpdateAccountRequest } from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, putDoc } from './sqlite/docs';
import { finAccount } from './sqlite/schema';

const key = (userId: string, accountId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  id: assertSafeId(accountId),
});

export async function getAccounts(userId: string): Promise<FinancialAccount[]> {
  const accounts = listDocs<FinancialAccount>(finAccount, { userId: assertSafeId(userId, 'userId') });

  // Sort by creation date, newest first
  return accounts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getActiveAccounts(userId: string): Promise<FinancialAccount[]> {
  const accounts = await getAccounts(userId);
  return accounts.filter(a => !a.isArchived);
}

export async function getAccountById(userId: string, accountId: string): Promise<FinancialAccount | null> {
  return getDoc<FinancialAccount>(finAccount, key(userId, accountId));
}

export async function createAccount(userId: string, data: CreateAccountRequest): Promise<FinancialAccount> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const account: FinancialAccount = {
    id,
    userId,
    name: data.name,
    currency: data.currency,
    startingBalance: data.startingBalance,
    startingDate: data.startingDate,
    planningHorizonMonths: data.planningHorizonMonths,
    customEndDate: data.customEndDate,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  putDoc(finAccount, key(userId, id), account);
  return account;
}

export async function updateAccount(
  userId: string,
  accountId: string,
  updates: UpdateAccountRequest
): Promise<FinancialAccount | null> {
  return inTx(() => {
    const account = getDoc<FinancialAccount>(finAccount, key(userId, accountId));
    if (!account) {
      return null;
    }

    const updatedAccount: FinancialAccount = {
      ...account,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    putDoc(finAccount, key(userId, accountId), updatedAccount);
    return updatedAccount;
  });
}

export async function archiveAccount(userId: string, accountId: string): Promise<FinancialAccount | null> {
  return updateAccount(userId, accountId, { isArchived: true });
}

export async function unarchiveAccount(userId: string, accountId: string): Promise<FinancialAccount | null> {
  return updateAccount(userId, accountId, { isArchived: false });
}

// Deletes the account row only; its recurring/planned/salary/taxed-income rows
// stay (as the file layout's subdirectories did).
export async function deleteAccount(userId: string, accountId: string): Promise<boolean> {
  deleteRows(finAccount, key(userId, accountId));
  return true;
}
