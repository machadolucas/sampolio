import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  PlannedItem,
  CreatePlannedItemRequest,
  UpdatePlannedItemRequest
} from '@/types';
import {
  getUserDir,
  ensureDir,
  readEncryptedFile,
  writeEncryptedFile,
  listFiles,
  deleteFile,
} from './encryption';

function getPlannedItemsDir(userId: string, accountId: string): string {
  return path.join(getUserDir(userId), 'accounts', accountId, 'planned');
}

function getPlannedItemFile(userId: string, accountId: string, itemId: string): string {
  return path.join(getPlannedItemsDir(userId, accountId), `${itemId}.enc`);
}

export async function getPlannedItems(userId: string, accountId: string): Promise<PlannedItem[]> {
  const itemsDir = getPlannedItemsDir(userId, accountId);
  await ensureDir(itemsDir);

  const files = await listFiles(itemsDir);
  const encFiles = files.filter(file => file.endsWith('.enc'));
  const results = await Promise.all(
    encFiles.map(file => readEncryptedFile<PlannedItem>(path.join(itemsDir, file)))
  );
  const items = results.filter((item): item is PlannedItem => item !== null);

  // Sort by scheduled date or first occurrence
  return items.sort((a, b) => {
    const dateA = a.scheduledDate || a.firstOccurrence || '';
    const dateB = b.scheduledDate || b.firstOccurrence || '';
    return dateA.localeCompare(dateB);
  });
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
  const itemFile = getPlannedItemFile(userId, accountId, itemId);
  return readEncryptedFile<PlannedItem>(itemFile);
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
    createdAt: now,
    updatedAt: now,
  };

  const itemsDir = getPlannedItemsDir(userId, data.accountId);
  await ensureDir(itemsDir);

  const itemFile = getPlannedItemFile(userId, data.accountId, id);
  await writeEncryptedFile(itemFile, item);

  return item;
}

export async function updatePlannedItem(
  userId: string,
  accountId: string,
  itemId: string,
  updates: UpdatePlannedItemRequest
): Promise<PlannedItem | null> {
  const item = await getPlannedItemById(userId, accountId, itemId);
  if (!item) {
    return null;
  }

  const updatedItem: PlannedItem = {
    ...item,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const itemFile = getPlannedItemFile(userId, accountId, itemId);
  await writeEncryptedFile(itemFile, updatedItem);

  return updatedItem;
}

export async function deletePlannedItem(
  userId: string,
  accountId: string,
  itemId: string
): Promise<boolean> {
  const itemFile = getPlannedItemFile(userId, accountId, itemId);
  await deleteFile(itemFile);
  return true;
}
