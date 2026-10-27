/**
 * Financial data tables.
 *
 * Document rows: each row stores one entity's exact JSON in `data`, so every
 * field round-trips, including legacy or stray ones. The other columns are
 * lookup keys only (sorting stays in the DB modules). The SQLCipher file is
 * already encrypted, so rows carry no per-row encryption.
 *
 * Ordered lists (reconciliation, bank ledgers, sync runs, split expenses
 * within a month, member indexes) keep their order in `seq`. There are
 * deliberately no foreign keys between these tables or to `user`: deleting an
 * account leaves its items (they never cascaded), so cascading deletes are
 * explicit in the DB modules, inside one transaction.
 *
 * Access goes through `src/lib/db/sqlite/docs.ts`.
 */
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const data = () => text('data').notNull();

// ── User-scoped ─────────────────────────────────────────────────────────────

/** UserPreferences, one per user */
export const userPreferences = sqliteTable('user_preferences', {
  userId: text('userId').primaryKey(),
  data: data(),
});

/** FinancialAccount (cash accounts) */
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

/** RecurringItem, per account */
export const recurringItem = accountChild('recurring_item');
/** PlannedItem (incl. occurrence overrides), per account */
export const plannedItem = accountChild('planned_item');
/** SalaryConfig, per account */
export const salaryConfig = accountChild('salary_config');
/** TaxedIncome, per account */
export const taxedIncome = accountChild('taxed_income');

const userDoc = (name: string) =>
  sqliteTable(
    name,
    { userId: text('userId').notNull(), id: text('id').notNull(), data: data() },
    (t) => [primaryKey({ columns: [t.userId, t.id] })],
  );

/** InvestmentAccount */
export const investment = userDoc('investment');
/** Debt */
export const debt = userDoc('debt');
/** Receivable */
export const receivable = userDoc('receivable');
/** Budget (lines, funding sources, expense entries embedded) */
export const budget = userDoc('budget');
/** Goal */
export const goal = userDoc('goal');
/** Trip (days + rate snapshot embedded) */
export const trip = userDoc('trip');
/** BankConnection (linkedAccounts embedded) */
export const bankConnection = userDoc('bank_connection');

/** InvestmentContribution, per investment */
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

/** DebtReferenceRate, per debt */
export const debtReferenceRate = debtChild('debt_reference_rate');
/** DebtExtraPayment, per debt */
export const debtExtraPayment = debtChild('debt_extra_payment');

/** ReceivableRepayment, per receivable */
export const receivableRepayment = sqliteTable(
  'receivable_repayment',
  { userId: text('userId').notNull(), receivableId: text('receivableId').notNull(), id: text('id').notNull(), data: data() },
  (t) => [primaryKey({ columns: [t.userId, t.receivableId, t.id] })],
);

/** BalanceSnapshot, ordered per user */
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

/** ReconciliationAdjustment, ordered per user */
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

/** ReconciliationSession, ordered per user */
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

/** BankSessionSecret, one per connection (never cached) */
export const bankSessionSecret = sqliteTable(
  'bank_session_secret',
  { userId: text('userId').notNull(), connectionId: text('connectionId').notNull(), data: data() },
  (t) => [primaryKey({ columns: [t.userId, t.connectionId] })],
);

/** BankTransaction, the ordered ledger of one linked account
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

/** BankSyncRun, per connection (`seq` 0 = newest) */
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

/** AppSettings (single row, id `app`) */
export const appSettings = sqliteTable('app_settings', {
  id: text('id').primaryKey(),
  data: data(),
});

/** SharedMortgage (loans + members embedded) */
export const mortgage = sqliteTable('mortgage', { id: text('id').primaryKey(), data: data() });

const mortgageChild = (name: string) =>
  sqliteTable(
    name,
    { mortgageId: text('mortgageId').notNull(), id: text('id').notNull(), data: data() },
    (t) => [primaryKey({ columns: [t.mortgageId, t.id] })],
  );

/** MortgageRateEntry, per mortgage */
export const mortgageRate = mortgageChild('mortgage_rate');
/** MortgageCostEntry, per mortgage */
export const mortgageCost = mortgageChild('mortgage_cost');
/** MortgageExtraPayment, per mortgage */
export const mortgageExtraPayment = mortgageChild('mortgage_extra_payment');
/** MortgageBalanceSnapshot, per mortgage */
export const mortgageBalanceSnapshot = mortgageChild('mortgage_balance_snapshot');
/** MortgageActualEntry, per mortgage */
export const mortgageActual = mortgageChild('mortgage_actual');

/** Reverse index userId → mortgage ids (key-only rows) */
export const mortgageMemberIndex = sqliteTable(
  'mortgage_member_index',
  { userId: text('userId').notNull(), mortgageId: text('mortgageId').notNull(), seq: integer('seq').notNull() },
  (t) => [primaryKey({ columns: [t.userId, t.mortgageId] })],
);

/** SplitGroup (members + recurrence rules embedded) */
export const splitGroup = sqliteTable('split_group', { id: text('id').primaryKey(), data: data() });

/** SplitExpense, grouped by storage month (`seq` = position in the month) */
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

/** SplitGroupSummary, one per group */
export const splitGroupSummary = sqliteTable('split_group_summary', {
  groupId: text('groupId').primaryKey(),
  data: data(),
});

/** Reverse index userId → split group ids (key-only rows) */
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
