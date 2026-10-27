/**
 * Financial data tables (everything that used to be an `.enc` file).
 *
 * Document rows: each row stores one entity's exact JSON in `data` — the same
 * compact JSON the file held — so every field round-trips, including legacy
 * or stray ones. The other columns are lookup keys only (sorting stays in the
 * DB modules, exactly as before). The SQLCipher file is already encrypted, so
 * rows carry no per-row encryption.
 *
 * Identity mirrors the former file paths: one row per former file, and one
 * row per element (`seq` = its position) for the former aggregate/chunk files
 * (reconciliation, bank ledgers, sync runs, split expenses, member indexes).
 * There are deliberately no foreign keys between these tables or to `user`:
 * deleting a parent never cascaded on disk (an account's children outlive it),
 * and a cascade would silently change that. Cascading deletes are explicit in
 * the DB modules, inside one transaction.
 *
 * Access goes through `src/lib/db/sqlite/docs.ts`; `file-import.ts` fills them
 * once from the `.enc` tree.
 */
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const data = () => text('data').notNull();

// ── User-scoped ─────────────────────────────────────────────────────────────

/** `users/{userId}/preferences.enc` */
export const userPreferences = sqliteTable('user_preferences', {
  userId: text('userId').primaryKey(),
  data: data(),
});

/** `users/{userId}/accounts/{id}.enc` */
export const finAccount = sqliteTable(
  'fin_account',
  { userId: text('userId').notNull(), id: text('id').notNull(), data: data() },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

const accountChild = (name: string) =>
  sqliteTable(
    name,
    { userId: text('userId').notNull(), accountId: text('accountId').notNull(), id: text('id').notNull(), data: data() },
    (t) => [primaryKey({ columns: [t.userId, t.accountId, t.id] })],
  );

/** `users/{userId}/accounts/{accountId}/recurring/{id}.enc` */
export const recurringItem = accountChild('recurring_item');
/** `users/{userId}/accounts/{accountId}/planned/{id}.enc` */
export const plannedItem = accountChild('planned_item');
/** `users/{userId}/accounts/{accountId}/salary/{id}.enc` */
export const salaryConfig = accountChild('salary_config');
/** `users/{userId}/accounts/{accountId}/taxed-income/{id}.enc` */
export const taxedIncome = accountChild('taxed_income');

const userDoc = (name: string) =>
  sqliteTable(
    name,
    { userId: text('userId').notNull(), id: text('id').notNull(), data: data() },
    (t) => [primaryKey({ columns: [t.userId, t.id] })],
  );

/** `users/{userId}/investments/{id}.enc` */
export const investment = userDoc('investment');
/** `users/{userId}/debts/{id}.enc` */
export const debt = userDoc('debt');
/** `users/{userId}/receivables/{id}.enc` */
export const receivable = userDoc('receivable');
/** `users/{userId}/budgets/{id}.enc` */
export const budget = userDoc('budget');
/** `users/{userId}/goals/{id}.enc` */
export const goal = userDoc('goal');
/** `users/{userId}/trips/{id}.enc` */
export const trip = userDoc('trip');
/** `users/{userId}/bank/connections/{id}.enc` */
export const bankConnection = userDoc('bank_connection');

/** `users/{userId}/investments/{investmentId}/contributions/{id}.enc` */
export const investmentContribution = sqliteTable(
  'investment_contribution',
  { userId: text('userId').notNull(), investmentId: text('investmentId').notNull(), id: text('id').notNull(), data: data() },
  (t) => [primaryKey({ columns: [t.userId, t.investmentId, t.id] })],
);

const debtChild = (name: string) =>
  sqliteTable(
    name,
    { userId: text('userId').notNull(), debtId: text('debtId').notNull(), id: text('id').notNull(), data: data() },
    (t) => [primaryKey({ columns: [t.userId, t.debtId, t.id] })],
  );

/** `users/{userId}/debts/{debtId}/reference-rates/{id}.enc` */
export const debtReferenceRate = debtChild('debt_reference_rate');
/** `users/{userId}/debts/{debtId}/extra-payments/{id}.enc` */
export const debtExtraPayment = debtChild('debt_extra_payment');

/** `users/{userId}/receivables/{receivableId}/repayments/{id}.enc` */
export const receivableRepayment = sqliteTable(
  'receivable_repayment',
  { userId: text('userId').notNull(), receivableId: text('receivableId').notNull(), id: text('id').notNull(), data: data() },
  (t) => [primaryKey({ columns: [t.userId, t.receivableId, t.id] })],
);

/** Element of `users/{userId}/reconciliation/balance-snapshots.enc` */
export const balanceSnapshot = sqliteTable(
  'balance_snapshot',
  {
    userId: text('userId').notNull(),
    id: text('id').notNull(),
    seq: integer('seq').notNull(),
    data: data(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), index('balance_snapshot_seq').on(t.userId, t.seq)],
);

/** Element of `users/{userId}/reconciliation/reconciliation-adjustments.enc` */
export const reconciliationAdjustment = sqliteTable(
  'reconciliation_adjustment',
  {
    userId: text('userId').notNull(),
    id: text('id').notNull(),
    seq: integer('seq').notNull(),
    data: data(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), index('reconciliation_adjustment_seq').on(t.userId, t.seq)],
);

/** Element of `users/{userId}/reconciliation/reconciliation-sessions.enc` */
export const reconciliationSession = sqliteTable(
  'reconciliation_session',
  {
    userId: text('userId').notNull(),
    id: text('id').notNull(),
    seq: integer('seq').notNull(),
    data: data(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), index('reconciliation_session_seq').on(t.userId, t.seq)],
);

/** `users/{userId}/bank/connections/{connectionId}.session.enc` */
export const bankSessionSecret = sqliteTable(
  'bank_session_secret',
  { userId: text('userId').notNull(), connectionId: text('connectionId').notNull(), data: data() },
  (t) => [primaryKey({ columns: [t.userId, t.connectionId] })],
);

/** Element of `users/{userId}/bank/accounts/{linkedAccountId}/transactions.enc`
 * (no uniqueness on `dedupKey`: identical `#occN` rows are legitimate). */
export const bankTransaction = sqliteTable(
  'bank_transaction',
  {
    userId: text('userId').notNull(),
    linkedAccountId: text('linkedAccountId').notNull(),
    seq: integer('seq').notNull(),
    data: data(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.linkedAccountId, t.seq] })],
);

/** Element of `users/{userId}/bank/sync-runs/{connectionId}.enc` */
export const bankSyncRun = sqliteTable(
  'bank_sync_run',
  {
    userId: text('userId').notNull(),
    connectionId: text('connectionId').notNull(),
    seq: integer('seq').notNull(),
    data: data(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.connectionId, t.seq] })],
);

// ── Global ──────────────────────────────────────────────────────────────────

/** `app-settings.enc` (single row, id `app`) */
export const appSettings = sqliteTable('app_settings', {
  id: text('id').primaryKey(),
  data: data(),
});

/** `shared/mortgages/{id}.enc` */
export const mortgage = sqliteTable('mortgage', { id: text('id').primaryKey(), data: data() });

const mortgageChild = (name: string) =>
  sqliteTable(
    name,
    { mortgageId: text('mortgageId').notNull(), id: text('id').notNull(), data: data() },
    (t) => [primaryKey({ columns: [t.mortgageId, t.id] })],
  );

/** `shared/mortgages/{mortgageId}/rates/{id}.enc` */
export const mortgageRate = mortgageChild('mortgage_rate');
/** `shared/mortgages/{mortgageId}/costs/{id}.enc` */
export const mortgageCost = mortgageChild('mortgage_cost');
/** `shared/mortgages/{mortgageId}/extra-payments/{id}.enc` */
export const mortgageExtraPayment = mortgageChild('mortgage_extra_payment');
/** `shared/mortgages/{mortgageId}/snapshots/{id}.enc` */
export const mortgageBalanceSnapshot = mortgageChild('mortgage_balance_snapshot');
/** `shared/mortgages/{mortgageId}/actuals/{id}.enc` */
export const mortgageActual = mortgageChild('mortgage_actual');

/** Element of `shared/mortgage-members/{userId}.enc` `{ mortgageIds }` */
export const mortgageMemberIndex = sqliteTable(
  'mortgage_member_index',
  { userId: text('userId').notNull(), mortgageId: text('mortgageId').notNull(), seq: integer('seq').notNull() },
  (t) => [primaryKey({ columns: [t.userId, t.mortgageId] })],
);

/** `shared/split-groups/{id}.enc` */
export const splitGroup = sqliteTable('split_group', { id: text('id').primaryKey(), data: data() });

/** Element of `shared/split-groups/{groupId}/expenses/{yearMonth}.enc` */
export const splitExpense = sqliteTable(
  'split_expense',
  {
    groupId: text('groupId').notNull(),
    id: text('id').notNull(),
    yearMonth: text('yearMonth').notNull(),
    seq: integer('seq').notNull(),
    data: data(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.id] }), index('split_expense_month').on(t.groupId, t.yearMonth, t.seq)],
);

/** `shared/split-groups/{groupId}/summary.enc` */
export const splitGroupSummary = sqliteTable('split_group_summary', {
  groupId: text('groupId').primaryKey(),
  data: data(),
});

/** Element of `shared/split-group-members/{userId}.enc` `{ groupIds }` */
export const splitGroupMemberIndex = sqliteTable(
  'split_group_member_index',
  { userId: text('userId').notNull(), groupId: text('groupId').notNull(), seq: integer('seq').notNull() },
  (t) => [primaryKey({ columns: [t.userId, t.groupId] })],
);

/** Every user-scoped finance table (hard delete, reset, import checks). */
export const USER_SCOPED_TABLES = [
  userPreferences,
  finAccount,
  recurringItem,
  plannedItem,
  salaryConfig,
  taxedIncome,
  investment,
  investmentContribution,
  debt,
  debtReferenceRate,
  debtExtraPayment,
  receivable,
  receivableRepayment,
  budget,
  goal,
  trip,
  balanceSnapshot,
  reconciliationAdjustment,
  reconciliationSession,
  bankConnection,
  bankSessionSecret,
  bankTransaction,
  bankSyncRun,
] as const;

/** Every finance table, user-scoped and global. */
export const FINANCE_TABLES = [
  ...USER_SCOPED_TABLES,
  appSettings,
  mortgage,
  mortgageRate,
  mortgageCost,
  mortgageExtraPayment,
  mortgageBalanceSnapshot,
  mortgageActual,
  mortgageMemberIndex,
  splitGroup,
  splitExpense,
  splitGroupSummary,
  splitGroupMemberIndex,
] as const;
