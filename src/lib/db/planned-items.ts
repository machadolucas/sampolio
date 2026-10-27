import { v4 as uuidv4 } from 'uuid';
import type {
  PlannedItem,
  CreatePlannedItemRequest,
  UpdatePlannedItemRequest
} from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, putDoc } from './sqlite/docs';
import { plannedItem } from './sqlite/schema';

const scope = (userId: string, accountId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  accountId: assertSafeId(accountId, 'accountId'),
});
const key = (userId: string, accountId: string, itemId: string) => ({
  ...scope(userId, accountId),
  id: assertSafeId(itemId),
});

function readPlannedItems(userId: string, accountId: string): PlannedItem[] {
  const items = listDocs<PlannedItem>(plannedItem, scope(userId, accountId));

  // Sort by scheduled date or first occurrence
  return items.sort((a, b) => {
    const dateA = a.scheduledDate || a.firstOccurrence || '';
    const dateB = b.scheduledDate || b.firstOccurrence || '';
    return dateA.localeCompare(dateB);
  });
}

export async function getPlannedItems(userId: string, accountId: string): Promise<PlannedItem[]> {
  return readPlannedItems(userId, accountId);
}

export async function getPlannedItemsByKind(
  userId: string,
  accountId: string,
  kind: 'one-off' | 'repeating'
): Promise<PlannedItem[]> {
  const items = await getPlannedItems(userId, accountId);
  return items.filter(item => item.kind === kind);
}

export async function getPlannedItemsByType(
  userId: string,
  accountId: string,
  type: 'income' | 'expense'
): Promise<PlannedItem[]> {
  const items = await getPlannedItems(userId, accountId);
  return items.filter(item => item.type === type);
}

export async function getPlannedItemById(
  userId: string,
  accountId: string,
  itemId: string
): Promise<PlannedItem | null> {
  return getDoc<PlannedItem>(plannedItem, key(userId, accountId, itemId));
}

export async function createPlannedItem(
  userId: string,
  data: CreatePlannedItemRequest
): Promise<PlannedItem> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const item: PlannedItem = {
    id,
    accountId: data.accountId,
    type: data.type,
    kind: data.kind,
    name: data.name,
    amount: data.amount,
    category: data.category,
    scheduledDate: data.scheduledDate,
    frequency: data.frequency,
    customIntervalMonths: data.customIntervalMonths,
    firstOccurrence: data.firstOccurrence,
    endDate: data.endDate,
    // Shared-expense fields
    isShared: data.isShared,
    shareRatio: data.shareRatio,
    // Charged to a credit card (excluded from direct cash; rolls into card bill)
    paidByCardLinkId: data.paidByCardLinkId,
    // Fixed-price bill: current-month actualization never gap-estimates it
    isFixedAmount: data.isFixedAmount,
    // Reimbursement tracking (one-off)
    isReimbursable: data.isReimbursable,
    reimbursementStatus: data.isReimbursable ? 'pending' : undefined,
    expectedReimbursementMonth: data.expectedReimbursementMonth,
    // Recurring-item occurrence override metadata — MUST persist, otherwise the
    // override is read back as a plain one-off and double-counts against the
    // recurring occurrence (and re-edits can't find it, creating duplicates).
    linkedRecurringItemId: data.linkedRecurringItemId,
    isRecurringOverride: data.isRecurringOverride,
    skipOccurrence: data.skipOccurrence,
    createdAt: now,
    updatedAt: now,
  };

  putDoc(plannedItem, key(userId, data.accountId, id), item);

  return item;
}

export async function updatePlannedItem(
  userId: string,
  accountId: string,
  itemId: string,
  updates: UpdatePlannedItemRequest
): Promise<PlannedItem | null> {
  return inTx(() => {
    const item = getDoc<PlannedItem>(plannedItem, key(userId, accountId, itemId));
    if (!item) {
      return null;
    }

    const updatedItem: PlannedItem = {
      ...item,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Reimbursement consistency: the spread above can't clear stale fields
    // (server-action JSON drops `undefined` keys, so "unset" never arrives as an
    // explicit key). Normalize here, where the merged item is available.
    if (updates.isReimbursable === false) {
      updatedItem.isReimbursable = false;
      updatedItem.reimbursementStatus = undefined;
      updatedItem.expectedReimbursementMonth = undefined;
    } else if (updates.isReimbursable === true && !updatedItem.reimbursementStatus) {
      // Newly marked reimbursable on edit: default to pending (mirrors create).
      updatedItem.reimbursementStatus = 'pending';
    }

    putDoc(plannedItem, key(userId, accountId, itemId), updatedItem);

    return updatedItem;
  });
}

export async function deletePlannedItem(
  userId: string,
  accountId: string,
  itemId: string
): Promise<boolean> {
  deleteRows(plannedItem, key(userId, accountId, itemId));
  return true;
}

/**
 * Delete every occurrence override of a recurring item (planned items with
 * `isRecurringOverride` + `linkedRecurringItemId`). Called when the recurring
 * item itself is deleted so its overrides don't linger as orphans. Reads the
 * rows directly (uncached) and returns how many were removed.
 */
export async function deletePlannedOverridesForRecurringItem(
  userId: string,
  accountId: string,
  recurringItemId: string
): Promise<number> {
  return inTx(() => {
    const overrides = readPlannedItems(userId, accountId).filter(
      item => item.isRecurringOverride && item.linkedRecurringItemId === recurringItemId
    );
    for (const override of overrides) {
      deleteRows(plannedItem, key(userId, accountId, override.id));
    }
    return overrides.length;
  });
}
