import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { assertSafeId } from './encryption';
import { deleteRows, inTx } from './sqlite/docs';
import {
  balanceSnapshot,
  bankConnection,
  bankSessionSecret,
  bankSyncRun,
  bankTransaction,
  budget,
  debt,
  debtExtraPayment,
  debtReferenceRate,
  finAccount,
  goal,
  investment,
  investmentContribution,
  plannedItem,
  receivable,
  receivableRepayment,
  reconciliationAdjustment,
  reconciliationSession,
  recurringItem,
  salaryConfig,
  taxedIncome,
  trip,
  USER_SCOPED_TABLES,
} from './sqlite/schema';

/**
 * A user's owned financial data, grouped the way the former `users/{id}/`
 * sub-directories were (removing `accounts/` also removed every account's
 * items, orphans included). Used by backup replace mode and "Start fresh".
 * Preferences, shared split groups and shared mortgages are never in a group.
 */
export const USER_DATA_GROUPS = {
  accounts: [finAccount, recurringItem, plannedItem, salaryConfig, taxedIncome],
  investments: [investment, investmentContribution],
  receivables: [receivable, receivableRepayment],
  debts: [debt, debtReferenceRate, debtExtraPayment],
  goals: [goal],
  budgets: [budget],
  trips: [trip],
  reconciliation: [balanceSnapshot, reconciliationAdjustment, reconciliationSession],
  bank: [bankConnection, bankSessionSecret, bankTransaction, bankSyncRun],
} satisfies Record<string, SQLiteTable[]>;

export type UserDataGroup = keyof typeof USER_DATA_GROUPS;

/** Delete the user's rows in the given groups, in one transaction. */
export function deleteUserDataGroups(userId: string, groups: readonly UserDataGroup[]): void {
  const uid = assertSafeId(userId, 'userId');
  inTx(() => {
    for (const g of groups) for (const table of USER_DATA_GROUPS[g]) deleteRows(table, { userId: uid });
  });
}

/** Delete every user-scoped finance row (preferences included), in one transaction. */
export function deleteAllUserData(userId: string): void {
  const uid = assertSafeId(userId, 'userId');
  inTx(() => {
    for (const table of USER_SCOPED_TABLES) deleteRows(table, { userId: uid });
  });
}
