import * as fs from 'fs/promises';
import * as path from 'path';
import {
  getUserDir,
  ensureDir,
  readEncryptedFile,
  writeEncryptedFile,
  entityPath,
  entityDir,
  assertSafeId,
} from './encryption';
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

// Writes an export payload back to disk at the canonical per-entity paths.
// Bypasses the db `create*` functions on purpose: those regenerate ids and
// timestamps, which would break every cross-reference in the backup. Ids and
// createdAt/updatedAt are preserved; only `userId` is rewritten to the
// importing user. NEVER touches bank data (`bank-connections/` etc.) — bank
// state is tied to this instance's consents and is not part of the backup.

// Dirs owned by the export payload — the ONLY ones replace mode may remove.
// `trips` is removed only when the payload carries a `trips` array (export
// v2+): a v1 backup predates trips, so replacing from it keeps existing trips.
const EXPORTED_DIRS = ['accounts', 'investments', 'receivables', 'debts', 'goals', 'budgets', 'reconciliation'];

/**
 * Read every user-scoped entity for a backup straight from disk (never the
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

async function writeRows(dir: string, rows: Row[], userId: string): Promise<number> {
  if (rows.length === 0) return 0;
  await ensureDir(dir);
  await Promise.all(
    rows.map((row) => writeEncryptedFile(entityPath(dir, row.id), { ...row, userId }))
  );
  return rows.length;
}

// Every id that becomes a path segment, validated BEFORE replace mode deletes
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

async function mergeAggregateFile<T extends { id: string }>(
  filePath: string,
  key: string,
  incoming: T[],
  mode: 'merge' | 'replace'
): Promise<void> {
  const existing = mode === 'merge' ? await readEncryptedFile<Record<string, T[]>>(filePath) : null;
  const merged = mergeById(existing?.[key] ?? [], incoming);
  await writeEncryptedFile(filePath, { [key]: merged });
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
  const userDir = getUserDir(userId);
  assertExportIds(data);

  const e = data.entities;
  if (mode === 'replace') {
    const dirs = e.trips !== undefined ? [...EXPORTED_DIRS, 'trips'] : EXPORTED_DIRS;
    await Promise.all(
      dirs.map((d) => fs.rm(path.join(userDir, d), { recursive: true, force: true }))
    );
  }

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

  for (const account of e.accounts) {
    const { recurringItems, plannedItems, salaryConfigs, taxedIncomes, ...accountRow } = account;
    await writeRows(path.join(userDir, 'accounts'), [accountRow as unknown as Row], userId);
    counts.accounts++;
    const base = entityDir(path.join(userDir, 'accounts'), account.id);
    counts.accountSubItems += await writeRows(path.join(base, 'recurring'), recurringItems as unknown as Row[], userId);
    counts.accountSubItems += await writeRows(path.join(base, 'planned'), plannedItems as unknown as Row[], userId);
    counts.accountSubItems += await writeRows(path.join(base, 'salary'), salaryConfigs as unknown as Row[], userId);
    counts.accountSubItems += await writeRows(path.join(base, 'taxed-income'), taxedIncomes as unknown as Row[], userId);
  }

  for (const investment of e.investments) {
    const { contributions, ...row } = investment;
    await writeRows(path.join(userDir, 'investments'), [row as unknown as Row], userId);
    counts.investments++;
    await writeRows(path.join(entityDir(path.join(userDir, 'investments'), investment.id), 'contributions'), contributions as unknown as Row[], userId);
  }

  for (const debt of e.debts) {
    const { referenceRates, extraPayments, ...row } = debt;
    await writeRows(path.join(userDir, 'debts'), [row as unknown as Row], userId);
    counts.debts++;
    await writeRows(path.join(entityDir(path.join(userDir, 'debts'), debt.id), 'reference-rates'), referenceRates as unknown as Row[], userId);
    await writeRows(path.join(entityDir(path.join(userDir, 'debts'), debt.id), 'extra-payments'), extraPayments as unknown as Row[], userId);
  }

  for (const receivable of e.receivables) {
    const { repayments, ...row } = receivable;
    await writeRows(path.join(userDir, 'receivables'), [row as unknown as Row], userId);
    counts.receivables++;
    await writeRows(path.join(entityDir(path.join(userDir, 'receivables'), receivable.id), 'repayments'), repayments as unknown as Row[], userId);
  }

  counts.goals = await writeRows(path.join(userDir, 'goals'), e.goals as unknown as Row[], userId);
  counts.budgets = await writeRows(path.join(userDir, 'budgets'), e.budgets as unknown as Row[], userId);
  // Trip ids are preserved, so budget funding sources' `linkedTripId` still resolve.
  if (e.trips !== undefined) {
    counts.trips = await writeRows(path.join(userDir, 'trips'), e.trips as unknown as Row[], userId);
  }

  // Reconciliation lives in three aggregate files, not one file per row.
  const reconDir = path.join(userDir, 'reconciliation');
  await ensureDir(reconDir);
  const stampUser = <T extends { id: string }>(rows: T[]) => rows.map((r) => ({ ...r, userId }));
  await mergeAggregateFile<BalanceSnapshot>(
    path.join(reconDir, 'balance-snapshots.enc'), 'snapshots',
    stampUser(e.reconciliation.snapshots as unknown as BalanceSnapshot[]), mode
  );
  await mergeAggregateFile<ReconciliationAdjustment>(
    path.join(reconDir, 'reconciliation-adjustments.enc'), 'adjustments',
    e.reconciliation.adjustments as unknown as ReconciliationAdjustment[], mode
  );
  await mergeAggregateFile<ReconciliationSession>(
    path.join(reconDir, 'reconciliation-sessions.enc'), 'sessions',
    stampUser(e.reconciliation.sessions as unknown as ReconciliationSession[]), mode
  );
  counts.snapshots = e.reconciliation.snapshots.length;

  if (e.preferences) {
    await writeEncryptedFile(path.join(userDir, 'preferences.enc'), e.preferences);
  }

  return counts;
}
