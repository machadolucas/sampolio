import { v4 as uuidv4 } from 'uuid';
import type {
  RecurringItem,
  CreateRecurringItemRequest,
  UpdateRecurringItemRequest
} from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, putDoc } from './sqlite/docs';
import { recurringItem } from './sqlite/schema';

const scope = (userId: string, accountId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  accountId: assertSafeId(accountId, 'accountId'),
});
const key = (userId: string, accountId: string, itemId: string) => ({
  ...scope(userId, accountId),
  id: assertSafeId(itemId),
});

export async function getRecurringItems(userId: string, accountId: string): Promise<RecurringItem[]> {
  const items = listDocs<RecurringItem>(recurringItem, scope(userId, accountId));

  // Sort by name
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getActiveRecurringItems(userId: string, accountId: string): Promise<RecurringItem[]> {
  const items = await getRecurringItems(userId, accountId);
  return items.filter(item => item.isActive);
}

export async function getRecurringItemsByType(
  userId: string,
  accountId: string,
  type: 'income' | 'expense'
): Promise<RecurringItem[]> {
  const items = await getRecurringItems(userId, accountId);
  return items.filter(item => item.type === type);
}

export async function getRecurringItemById(
  userId: string,
  accountId: string,
  itemId: string
): Promise<RecurringItem | null> {
  return getDoc<RecurringItem>(recurringItem, key(userId, accountId, itemId));
}

// Synchronous cores (also used inside salary-configs' transactions).
export function insertRecurringItem(userId: string, data: CreateRecurringItemRequest): RecurringItem {
  const id = uuidv4();
  const now = new Date().toISOString();

  const item: RecurringItem = {
    id,
    accountId: data.accountId,
    type: data.type,
    name: data.name,
    amount: data.amount,
    category: data.category,
    frequency: data.frequency,
    customIntervalMonths: data.customIntervalMonths,
    startDate: data.startDate,
    endDate: data.endDate,
    isShared: data.isShared,
    shareRatio: data.shareRatio,
    paidByCardLinkId: data.paidByCardLinkId,
    isFixedAmount: data.isFixedAmount,
    isActive: data.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  };

  putDoc(recurringItem, key(userId, data.accountId, id), item);

  return item;
}

export function patchRecurringItem(
  userId: string,
  accountId: string,
  itemId: string,
  updates: UpdateRecurringItemRequest
): RecurringItem | null {
  return inTx(() => {
    const item = getDoc<RecurringItem>(recurringItem, key(userId, accountId, itemId));
    if (!item) {
      return null;
    }

    const updatedItem: RecurringItem = {
      ...item,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    putDoc(recurringItem, key(userId, accountId, itemId), updatedItem);
    return updatedItem;
  });
}

export function removeRecurringItem(userId: string, accountId: string, itemId: string): void {
  deleteRows(recurringItem, key(userId, accountId, itemId));
}

export async function createRecurringItem(
  userId: string,
  data: CreateRecurringItemRequest
): Promise<RecurringItem> {
  return insertRecurringItem(userId, data);
}

export async function updateRecurringItem(
  userId: string,
  accountId: string,
  itemId: string,
  updates: UpdateRecurringItemRequest
): Promise<RecurringItem | null> {
  return patchRecurringItem(userId, accountId, itemId, updates);
}

export async function toggleRecurringItemActive(
  userId: string,
  accountId: string,
  itemId: string
): Promise<RecurringItem | null> {
  return inTx(() => {
    const item = getDoc<RecurringItem>(recurringItem, key(userId, accountId, itemId));
    if (!item) {
      return null;
    }

    return patchRecurringItem(userId, accountId, itemId, { isActive: !item.isActive });
  });
}

export async function deleteRecurringItem(
  userId: string,
  accountId: string,
  itemId: string
): Promise<boolean> {
  removeRecurringItem(userId, accountId, itemId);
  return true;
}
