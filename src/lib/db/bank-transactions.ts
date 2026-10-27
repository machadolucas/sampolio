/**
 * Enable Banking — transaction store.
 *
 * One ordered list per linked bank account (`bank_transaction`, one row per
 * transaction, `seq` = list position), holding the full deduped transaction
 * list. The sync engine reads the existing list, merges incoming rows with the
 * pure dedup helper, and writes the merged result back. This module only does
 * read/replace — the merge/dedup logic is pure (bank/dedup.ts).
 */

import type { BankTransaction } from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, listDocs, replaceSeqDocs } from './sqlite/docs';
import { bankTransaction } from './sqlite/schema';

const scope = (userId: string, linkedAccountId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  linkedAccountId: assertSafeId(linkedAccountId, 'linkedAccountId'),
});

export async function getBankTransactions(
  userId: string,
  linkedAccountId: string
): Promise<BankTransaction[]> {
  return listDocs<BankTransaction>(bankTransaction, scope(userId, linkedAccountId), 'seq');
}

/** Replace the full transaction list for a linked account (post-merge), atomically. */
export async function writeBankTransactions(
  userId: string,
  linkedAccountId: string,
  transactions: BankTransaction[]
): Promise<void> {
  replaceSeqDocs(bankTransaction, scope(userId, linkedAccountId), transactions);
}

export async function deleteBankTransactionsForAccount(
  userId: string,
  linkedAccountId: string
): Promise<void> {
  deleteRows(bankTransaction, scope(userId, linkedAccountId));
}
