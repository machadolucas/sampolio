import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { assertSafeId } from './encryption';
import { inTx, listDocs, putDoc, replaceSeqDocs, type Keys } from './sqlite/docs';
import {
  balanceSnapshot,
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
  userPreferences,
} from './sqlite/schema';
import { deleteUserDataGroups, type UserDataGroup } from './user-data';
import { getAccounts } from './accounts';
import { getRecurringItems } from './recurring-items';
import { getPlannedItems } from './planned-items';
import { getSalaryConfigs } from './salary-configs';
import { getTaxedIncomes } from './taxed-income';
import { getInvestmentAccounts, getContributions } from './investments';
import { getDebts, getReferenceRates, getExtraPayments } from './debts';
import { getReceivables, getRepayments } from './receivables';
import { getGoals } from './goals';
import { getBudgets } from './budgets';
import { getTrips } from './trips';
import { getUserPreferences } from './user-preferences';
import { getBalanceSnapshots, getAllAdjustments, getReconciliationSessions } from './reconciliation';
import { mergeById } from '@/lib/data-transfer-utils';
import type { DataExport } from '@/lib/schemas/data-transfer.schema';
import type { BalanceSnapshot, ReconciliationAdjustment, ReconciliationSession } from '@/types';

// Writes an export payload back as rows, in one transaction. Bypasses the db
// `create*` functions on purpose: those regenerate ids and timestamps, which
// would break every cross-reference in the backup. Ids and createdAt/updatedAt
// are preserved; only `userId` is rewritten to the importing user. NEVER
// touches bank data — bank state is tied to this instance's consents and is
// not part of the backup.

// Groups owned by the export payload — the ONLY ones replace mode may remove.
// `trips` is removed only when the payload carries a `trips` array (export
// v2+): a v1 backup predates trips, so replacing from it keeps existing trips.
const EXPORTED_GROUPS: UserDataGroup[] = ['accounts', 'investments', 'receivables', 'debts', 'goals', 'budgets', 'reconciliation'];

/**
 * Read every user-scoped entity for a backup straight from the DB (never the
 * `'use cache'` wrappers — a backup must match what is stored right now, and
 * some nested writes don't invalidate the aggregate caches' tags).
 */
export async function readUserDataForExport(userId: string): Promise<DataExport['entities']> {
  const [accounts, investments, debts, receivables, goals, budgets, trips, snapshots, adjustments, sessions, preferences] =
    await Promise.all([
      getAccounts(userId),
      getInvestmentAccounts(userId),
      getDebts(userId),
      getReceivables(userId),
      getGoals(userId),
      getBudgets(userId),
      getTrips(userId),
      getBalanceSnapshots(userId),
      getAllAdjustments(userId),
      getReconciliationSessions(userId),
      getUserPreferences(userId),
    ]);

  const [accountsWithItems, investmentsWithDetails, debtsWithDetails, receivablesWithDetails] = await Promise.all([
    Promise.all(
      accounts.map(async (account) => {
        const [recurringItems, plannedItems, salaryConfigs, taxedIncomes] = await Promise.all([
          getRecurringItems(userId, account.id),
          getPlannedItems(userId, account.id),
          getSalaryConfigs(userId, account.id),
          getTaxedIncomes(userId, account.id),
        ]);
        return { ...account, recurringItems, plannedItems, salaryConfigs, taxedIncomes };
      })
    ),
    Promise.all(investments.map(async (inv) => ({ ...inv, contributions: await getContributions(userId, inv.id) }))),
    Promise.all(
      debts.map(async (debt) => {
        const [referenceRates, extraPayments] = await Promise.all([
          getReferenceRates(userId, debt.id),
          getExtraPayments(userId, debt.id),
        ]);
        return { ...debt, referenceRates, extraPayments };
      })
    ),
    Promise.all(receivables.map(async (rec) => ({ ...rec, repayments: await getRepayments(userId, rec.id) }))),
  ]);

  return {
    accounts: accountsWithItems,
    investments: investmentsWithDetails,
    debts: debtsWithDetails,
    receivables: receivablesWithDetails,
    goals,
    budgets,
    trips,
    reconciliation: { snapshots, adjustments, sessions },
    preferences,
  };
}

type Row = { id: string } & Record<string, unknown>;

function writeRows(table: SQLiteTable, scope: Keys, rows: Row[], userId: string): number {
  for (const row of rows) putDoc(table, { ...scope, id: assertSafeId(row.id) }, { ...row, userId });
  return rows.length;
}

// Every id that becomes a row key, validated BEFORE replace mode deletes
// anything — a bad id must reject the whole payload, not half-apply it. The
// action's Zod schema already enforces this; this is the DB-layer backstop.
function assertExportIds(data: DataExport): void {
  const e = data.entities;
  const check = (rows: Array<{ id: string }>) => rows.forEach((r) => assertSafeId(r.id));
  for (const a of e.accounts) {
    check([a]);
    check(a.recurringItems);
    check(a.plannedItems);
    check(a.salaryConfigs);
    check(a.taxedIncomes);
  }
  for (const i of e.investments) { check([i]); check(i.contributions); }
  for (const d of e.debts) { check([d]); check(d.referenceRates); check(d.extraPayments); }
  for (const r of e.receivables) { check([r]); check(r.repayments); }
  check(e.goals);
  check(e.budgets);
  check(e.trips ?? []);
}

/** Merge rows into a former aggregate list (existing order kept, new rows appended). */
function mergeSeqList<T extends { id: string }>(
  table: SQLiteTable,
  userId: string,
  incoming: T[],
  mode: 'merge' | 'replace'
): void {
  const existing = mode === 'merge' ? listDocs<T>(table, { userId }, 'seq') : [];
  replaceSeqDocs(table, { userId }, mergeById(existing, incoming), (r) => ({ id: assertSafeId(r.id) }));
}

export interface ImportCounts {
  accounts: number;
  accountSubItems: number;
  investments: number;
  debts: number;
  receivables: number;
  goals: number;
  budgets: number;
  /** Trips restored; null when the backup predates trips (v1) and existing trips were left untouched. */
  trips: number | null;
  snapshots: number;
}

export async function writeUserDataFromExport(
  userId: string,
  data: DataExport,
  mode: 'merge' | 'replace'
): Promise<ImportCounts> {
  const uid = assertSafeId(userId, 'userId');
  assertExportIds(data);

  const e = data.entities;
  const counts: ImportCounts = {
    accounts: 0,
    accountSubItems: 0,
    investments: 0,
    debts: 0,
    receivables: 0,
    goals: 0,
    budgets: 0,
    trips: null,
    snapshots: 0,
  };

  inTx(() => {
    if (mode === 'replace') {
      deleteUserDataGroups(uid, e.trips !== undefined ? [...EXPORTED_GROUPS, 'trips'] : EXPORTED_GROUPS);
    }

    const user = { userId: uid };
    for (const account of e.accounts) {
      const { recurringItems, plannedItems, salaryConfigs, taxedIncomes, ...accountRow } = account;
      writeRows(finAccount, user, [accountRow as unknown as Row], uid);
      counts.accounts++;
      const base = { userId: uid, accountId: assertSafeId(account.id) };
      counts.accountSubItems += writeRows(recurringItem, base, recurringItems as unknown as Row[], uid);
      counts.accountSubItems += writeRows(plannedItem, base, plannedItems as unknown as Row[], uid);
      counts.accountSubItems += writeRows(salaryConfig, base, salaryConfigs as unknown as Row[], uid);
      counts.accountSubItems += writeRows(taxedIncome, base, taxedIncomes as unknown as Row[], uid);
    }

    for (const inv of e.investments) {
      const { contributions, ...row } = inv;
      writeRows(investment, user, [row as unknown as Row], uid);
      counts.investments++;
      writeRows(investmentContribution, { userId: uid, investmentId: assertSafeId(inv.id) }, contributions as unknown as Row[], uid);
    }

    for (const d of e.debts) {
      const { referenceRates, extraPayments, ...row } = d;
      writeRows(debt, user, [row as unknown as Row], uid);
      counts.debts++;
      const scope = { userId: uid, debtId: assertSafeId(d.id) };
      writeRows(debtReferenceRate, scope, referenceRates as unknown as Row[], uid);
      writeRows(debtExtraPayment, scope, extraPayments as unknown as Row[], uid);
    }

    for (const r of e.receivables) {
      const { repayments, ...row } = r;
      writeRows(receivable, user, [row as unknown as Row], uid);
      counts.receivables++;
      writeRows(receivableRepayment, { userId: uid, receivableId: assertSafeId(r.id) }, repayments as unknown as Row[], uid);
    }

    counts.goals = writeRows(goal, user, e.goals as unknown as Row[], uid);
    counts.budgets = writeRows(budget, user, e.budgets as unknown as Row[], uid);
    // Trip ids are preserved, so budget funding sources' `linkedTripId` still resolve.
    if (e.trips !== undefined) {
      counts.trips = writeRows(trip, user, e.trips as unknown as Row[], uid);
    }

    // Reconciliation rows keep the former aggregate lists' order (`seq`).
    const stampUser = <T extends { id: string }>(rows: T[]) => rows.map((r) => ({ ...r, userId: uid }));
    mergeSeqList<BalanceSnapshot>(
      balanceSnapshot, uid,
      stampUser(e.reconciliation.snapshots as unknown as BalanceSnapshot[]), mode
    );
    mergeSeqList<ReconciliationAdjustment>(
      reconciliationAdjustment, uid,
      e.reconciliation.adjustments as unknown as ReconciliationAdjustment[], mode
    );
    mergeSeqList<ReconciliationSession>(
      reconciliationSession, uid,
      stampUser(e.reconciliation.sessions as unknown as ReconciliationSession[]), mode
    );
    counts.snapshots = e.reconciliation.snapshots.length;

    if (e.preferences) {
      putDoc(userPreferences, user, e.preferences);
    }
  });

  return counts;
}
