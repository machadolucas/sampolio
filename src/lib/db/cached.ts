/**
 * Cached data access layer using Next.js 16 'use cache' directive.
 *
 * All read operations go through this module to benefit from in-memory caching.
 * Cache entries are tagged for granular invalidation when data is mutated.
 *
 * Tag convention:
 *   all-data                                          – admin force-revalidate
 *   user:{userId}                                     – per-user global
 *   user:{userId}:accounts                            – accounts collection
 *   user:{userId}:account:{accountId}:recurring       – recurring items
 *   user:{userId}:account:{accountId}:planned         – planned items
 *   user:{userId}:account:{accountId}:salary          – salary configs
 *   user:{userId}:account:{accountId}:taxed-income    – taxed income
 *   user:{userId}:investments                         – investment accounts
 *   user:{userId}:investment:{id}:contributions       – contributions
 *   user:{userId}:debts                               – debts
 *   user:{userId}:debt:{id}:rates                     – reference rates
 *   user:{userId}:debt:{id}:payments                  – extra payments
 *   user:{userId}:receivables                         – receivables
 *   user:{userId}:receivable:{id}:repayments          – repayments
 *   user:{userId}:preferences                         – user preferences
 *   user:{userId}:reconciliation                      – reconciliation data
 *   app-settings                                      – global app settings
 *   users                                             – all users list
 */

import { cacheTag, cacheLife } from 'next/cache';

// DB layer imports
import { getAccounts, getAccountById } from './accounts';
import { getRecurringItems, getRecurringItemById } from './recurring-items';
import { getPlannedItems, getPlannedItemById } from './planned-items';
import { getSalaryConfigs, getSalaryConfigById } from './salary-configs';
import { getTaxedIncomes, getTaxedIncomeById } from './taxed-income';
import {
  getInvestmentAccounts,
  getInvestmentAccountById,
  getContributions,
} from './investments';
import { getDebts, getDebtById, getReferenceRates, getExtraPayments } from './debts';
import { getReceivables, getReceivableById, getRepayments } from './receivables';
import { getUserPreferences } from './user-preferences';
import { getAppSettings } from './app-settings';
import { getAllUsers } from './users';
import {
  getBalanceSnapshots,
  getReconciliationSessions,
  getSnapshotsForEntity,
  getSnapshotsForMonth,
  getLatestSnapshot,
  getLatestCompletedSession,
  getSessionForMonth,
} from './reconciliation';

import type {
  FinancialAccount,
  RecurringItem,
  PlannedItem,
  SalaryConfig,
  TaxedIncome,
  InvestmentAccount,
  InvestmentContribution,
  Debt,
  DebtReferenceRate,
  DebtExtraPayment,
  Receivable,
  ReceivableRepayment,
  UserPreferences,
  AppSettings,
  User,
  BalanceSnapshot,
  ReconciliationSession,
  EntityType,
} from '@/types';

// ============================================================
// CASHFLOW DOMAIN
// ============================================================

export async function cachedGetAccounts(userId: string): Promise<FinancialAccount[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:accounts`);
  cacheLife('indefinite');
  return getAccounts(userId);
}

export async function cachedGetAccountById(
  userId: string,
  accountId: string
): Promise<FinancialAccount | null> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:accounts`);
  cacheLife('indefinite');
  return getAccountById(userId, accountId);
}

export async function cachedGetRecurringItems(
  userId: string,
  accountId: string
): Promise<RecurringItem[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:account:${accountId}:recurring`);
  cacheLife('indefinite');
  return getRecurringItems(userId, accountId);
}

export async function cachedGetRecurringItemById(
  userId: string,
  accountId: string,
  itemId: string
): Promise<RecurringItem | null> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:account:${accountId}:recurring`);
  cacheLife('indefinite');
  return getRecurringItemById(userId, accountId, itemId);
}

export async function cachedGetPlannedItems(
  userId: string,
  accountId: string
): Promise<PlannedItem[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:account:${accountId}:planned`);
  cacheLife('indefinite');
  return getPlannedItems(userId, accountId);
}

export async function cachedGetPlannedItemById(
  userId: string,
  accountId: string,
  itemId: string
): Promise<PlannedItem | null> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:account:${accountId}:planned`);
  cacheLife('indefinite');
  return getPlannedItemById(userId, accountId, itemId);
}

export async function cachedGetSalaryConfigs(
  userId: string,
  accountId: string
): Promise<SalaryConfig[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:account:${accountId}:salary`);
  cacheLife('indefinite');
  return getSalaryConfigs(userId, accountId);
}

export async function cachedGetSalaryConfigById(
  userId: string,
  accountId: string,
  configId: string
): Promise<SalaryConfig | null> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:account:${accountId}:salary`);
  cacheLife('indefinite');
  return getSalaryConfigById(userId, accountId, configId);
}

export async function cachedGetTaxedIncomes(
  userId: string,
  accountId: string
): Promise<TaxedIncome[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:account:${accountId}:taxed-income`);
  cacheLife('indefinite');
  return getTaxedIncomes(userId, accountId);
}

export async function cachedGetTaxedIncomeById(
  userId: string,
  accountId: string,
  incomeId: string
): Promise<TaxedIncome | null> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:account:${accountId}:taxed-income`);
  cacheLife('indefinite');
  return getTaxedIncomeById(userId, accountId, incomeId);
}

// ============================================================
// INVESTMENTS
// ============================================================

export async function cachedGetInvestmentAccounts(userId: string): Promise<InvestmentAccount[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:investments`);
  cacheLife('indefinite');
  return getInvestmentAccounts(userId);
}

export async function cachedGetInvestmentAccountById(
  userId: string,
  investmentId: string
): Promise<InvestmentAccount | null> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:investments`);
  cacheLife('indefinite');
  return getInvestmentAccountById(userId, investmentId);
}

export async function cachedGetContributions(
  userId: string,
  investmentId: string
): Promise<InvestmentContribution[]> {
  'use cache';
  cacheTag(
    'all-data',
    `user:${userId}`,
    `user:${userId}:investment:${investmentId}:contributions`
  );
  cacheLife('indefinite');
  return getContributions(userId, investmentId);
}

// ============================================================
// DEBTS
// ============================================================

export async function cachedGetDebts(userId: string): Promise<Debt[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:debts`);
  cacheLife('indefinite');
  return getDebts(userId);
}

export async function cachedGetDebtById(
  userId: string,
  debtId: string
): Promise<Debt | null> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:debts`);
  cacheLife('indefinite');
  return getDebtById(userId, debtId);
}

export async function cachedGetReferenceRates(
  userId: string,
  debtId: string
): Promise<DebtReferenceRate[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:debt:${debtId}:rates`);
  cacheLife('indefinite');
  return getReferenceRates(userId, debtId);
}

export async function cachedGetExtraPayments(
  userId: string,
  debtId: string
): Promise<DebtExtraPayment[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:debt:${debtId}:payments`);
  cacheLife('indefinite');
  return getExtraPayments(userId, debtId);
}

// ============================================================
// RECEIVABLES
// ============================================================

export async function cachedGetReceivables(userId: string): Promise<Receivable[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:receivables`);
  cacheLife('indefinite');
  return getReceivables(userId);
}

export async function cachedGetReceivableById(
  userId: string,
  receivableId: string
): Promise<Receivable | null> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:receivables`);
  cacheLife('indefinite');
  return getReceivableById(userId, receivableId);
}

export async function cachedGetRepayments(
  userId: string,
  receivableId: string
): Promise<ReceivableRepayment[]> {
  'use cache';
  cacheTag(
    'all-data',
    `user:${userId}`,
    `user:${userId}:receivable:${receivableId}:repayments`
  );
  cacheLife('indefinite');
  return getRepayments(userId, receivableId);
}

// ============================================================
// USER PREFERENCES
// ============================================================

export async function cachedGetUserPreferences(userId: string): Promise<UserPreferences> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:preferences`);
  cacheLife('indefinite');
  return getUserPreferences(userId);
}

// ============================================================
// ADMIN / GLOBAL
// ============================================================

export async function cachedGetAppSettings(): Promise<AppSettings> {
  'use cache';
  cacheTag('all-data', 'app-settings');
  cacheLife('indefinite');
  return getAppSettings();
}

export async function cachedGetAllUsers(): Promise<User[]> {
  'use cache';
  cacheTag('all-data', 'users');
  cacheLife('indefinite');
  return getAllUsers();
}

// ============================================================
// RECONCILIATION
// ============================================================

export async function cachedGetBalanceSnapshots(userId: string): Promise<BalanceSnapshot[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:reconciliation`);
  cacheLife('indefinite');
  return getBalanceSnapshots(userId);
}

export async function cachedGetSnapshotsForEntity(
  userId: string,
  entityType: EntityType,
  entityId: string
): Promise<BalanceSnapshot[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:reconciliation`);
  cacheLife('indefinite');
  return getSnapshotsForEntity(userId, entityType, entityId);
}

export async function cachedGetSnapshotsForMonth(
  userId: string,
  yearMonth: string
): Promise<BalanceSnapshot[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:reconciliation`);
  cacheLife('indefinite');
  return getSnapshotsForMonth(userId, yearMonth);
}

export async function cachedGetLatestSnapshot(
  userId: string,
  entityType: EntityType,
  entityId: string
): Promise<BalanceSnapshot | null> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:reconciliation`);
  cacheLife('indefinite');
  return getLatestSnapshot(userId, entityType, entityId);
}

export async function cachedGetReconciliationSessions(
  userId: string
): Promise<ReconciliationSession[]> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:reconciliation`);
  cacheLife('indefinite');
  return getReconciliationSessions(userId);
}

export async function cachedGetSessionForMonth(
  userId: string,
  yearMonth: string
): Promise<ReconciliationSession | null> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:reconciliation`);
  cacheLife('indefinite');
  return getSessionForMonth(userId, yearMonth);
}

export async function cachedGetLatestCompletedSession(
  userId: string
): Promise<ReconciliationSession | null> {
  'use cache';
  cacheTag('all-data', `user:${userId}`, `user:${userId}:reconciliation`);
  cacheLife('indefinite');
  return getLatestCompletedSession(userId);
}

// ============================================================
// BATCH READS — reduce waterfall for page-level data fetching
// ============================================================

/**
 * Fetch all data needed to compute cashflow projection for one account.
 * Called from the projection server action.
 */
export async function cachedGetAccountProjectionData(
  userId: string,
  accountId: string
): Promise<{
  recurringItems: RecurringItem[];
  plannedItems: PlannedItem[];
  salaryConfigs: SalaryConfig[];
  taxedIncomes: TaxedIncome[];
}> {
  'use cache';
  cacheTag(
    'all-data',
    `user:${userId}`,
    `user:${userId}:account:${accountId}:recurring`,
    `user:${userId}:account:${accountId}:planned`,
    `user:${userId}:account:${accountId}:salary`,
    `user:${userId}:account:${accountId}:taxed-income`
  );
  cacheLife('indefinite');

  const [recurringItems, plannedItems, salaryConfigs, taxedIncomes] = await Promise.all([
    getRecurringItems(userId, accountId),
    getPlannedItems(userId, accountId),
    getSalaryConfigs(userId, accountId),
    getTaxedIncomes(userId, accountId),
  ]);

  return { recurringItems, plannedItems, salaryConfigs, taxedIncomes };
}

/**
 * Fetch all wealth-related data (investments + debts + receivables)
 * with nested details, in a single cached call.
 */
export async function cachedGetWealthData(userId: string): Promise<{
  investments: Array<InvestmentAccount & { contributions: InvestmentContribution[] }>;
  debts: Array<Debt & { referenceRates: DebtReferenceRate[]; extraPayments: DebtExtraPayment[] }>;
  receivables: Array<Receivable & { repayments: ReceivableRepayment[] }>;
}> {
  'use cache';
  cacheTag(
    'all-data',
    `user:${userId}`,
    `user:${userId}:investments`,
    `user:${userId}:debts`,
    `user:${userId}:receivables`
  );
  cacheLife('indefinite');

  const [rawInvestments, rawDebts, rawReceivables] = await Promise.all([
    getInvestmentAccounts(userId),
    getDebts(userId),
    getReceivables(userId),
  ]);

  // Fetch nested data in parallel
  const [investmentDetails, debtDetails, receivableDetails] = await Promise.all([
    Promise.all(
      rawInvestments.map(async (inv) => ({
        ...inv,
        contributions: await getContributions(userId, inv.id),
      }))
    ),
    Promise.all(
      rawDebts.map(async (debt) => {
        const [referenceRates, extraPayments] = await Promise.all([
          getReferenceRates(userId, debt.id),
          getExtraPayments(userId, debt.id),
        ]);
        return { ...debt, referenceRates, extraPayments };
      })
    ),
    Promise.all(
      rawReceivables.map(async (rec) => ({
        ...rec,
        repayments: await getRepayments(userId, rec.id),
      }))
    ),
  ]);

  return {
    investments: investmentDetails,
    debts: debtDetails,
    receivables: receivableDetails,
  };
}
