import * as fs from 'fs/promises';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import { getTableName } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getDataDir, readEncryptedFile } from '../encryption';
import { isChunkMonth, isSafeId } from '@/lib/safe-id';
import { getDb } from './client';
import { countRows, getRawData, inTx, insertDoc, type Keys } from './docs';
import {
  appSettings,
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
  FINANCE_TABLES,
  goal,
  investment,
  investmentContribution,
  meta,
  mortgage,
  mortgageActual,
  mortgageBalanceSnapshot,
  mortgageCost,
  mortgageExtraPayment,
  mortgageMemberIndex,
  mortgageRate,
  plannedItem,
  receivable,
  receivableRepayment,
  reconciliationAdjustment,
  reconciliationSession,
  recurringItem,
  salaryConfig,
  splitExpense,
  splitGroup,
  splitGroupMemberIndex,
  splitGroupSummary,
  taxedIncome,
  trip,
  userPreferences,
} from './schema';

/**
 * One-shot import of the file-era financial data (`*.enc` under DATA_DIR) into
 * the finance tables (`schema/finance.ts`). Run by `bootstrap.ts` before any
 * scheduler starts; guarded by the `_meta` row `file-data-imported`.
 *
 * Lossless by construction and verified:
 *  - Every `*.enc` file must be claimed by a known layout path, or the import
 *    aborts listing the unclaimed files (nothing is silently skipped). The
 *    only ignored `.enc` files are the pre-4.0 user files that the 4.0 user
 *    import already moved into the `user` table.
 *  - Each file becomes one row (an aggregate/chunk file one row per element,
 *    `seq` = array index) storing exactly the parsed JSON. Plain INSERTs, so a
 *    key collision aborts instead of merging rows.
 *  - Inside the same transaction every row is read back and compared with its
 *    source, and per-table counts are checked; any mismatch rolls back.
 *  - The marker commits in that transaction, so a failed run retries on the
 *    next boot. If the marker is missing but finance rows exist, it refuses
 *    rather than mix data.
 *  - The `.enc` files are never modified or removed: they stay as the
 *    rollback/backup source until a later cleanup release.
 */

export const FILE_IMPORT_META_KEY = 'file-data-imported';

/** Thrown for any inconsistency; bootstrap fails closed on it. */
export class FileImportError extends Error {
  constructor(message: string) {
    super(`File data import aborted: ${message}`);
    this.name = 'FileImportError';
  }
}

export interface FileImportResult {
  status: 'imported' | 'already-imported';
  files: number;
  rows: number;
  byTable: Record<string, number>;
}

interface PlannedRow {
  table: SQLiteTable;
  keys: Keys;
  /** Parsed source JSON (for the key-only index tables, the id that became a key). */
  doc?: unknown;
  source: string;
}

// Pre-4.0 user records, already imported into the `user` table by 4.0 and no
// longer read by anything.
const LEGACY_USER_FILES = [/^users-index\.enc$/, /^users\/[^/]+\/user\.enc$/];

const ACCOUNT_CHILDREN: Record<string, SQLiteTable> = {
  recurring: recurringItem,
  planned: plannedItem,
  salary: salaryConfig,
  'taxed-income': taxedIncome,
};
const USER_DOCS: Record<string, SQLiteTable> = {
  accounts: finAccount,
  investments: investment,
  debts: debt,
  receivables: receivable,
  budgets: budget,
  goals: goal,
  trips: trip,
};
const DEBT_CHILDREN: Record<string, SQLiteTable> = {
  'reference-rates': debtReferenceRate,
  'extra-payments': debtExtraPayment,
};
const MORTGAGE_CHILDREN: Record<string, SQLiteTable> = {
  rates: mortgageRate,
  costs: mortgageCost,
  'extra-payments': mortgageExtraPayment,
  snapshots: mortgageBalanceSnapshot,
  actuals: mortgageActual,
};
const RECONCILIATION_FILES: Record<string, { table: SQLiteTable; key: string }> = {
  'balance-snapshots.enc': { table: balanceSnapshot, key: 'snapshots' },
  'reconciliation-adjustments.enc': { table: reconciliationAdjustment, key: 'adjustments' },
  'reconciliation-sessions.enc': { table: reconciliationSession, key: 'sessions' },
};

/** `<id>.enc` → id (safe ids only), else null. */
function encId(name: string, suffix = '.enc'): string | null {
  if (!name.endsWith(suffix)) return null;
  const id = name.slice(0, -suffix.length);
  return isSafeId(id) ? id : null;
}

async function walkEncFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!rel && e.name === 'snapshots') continue; // SQLite snapshots
        await walk(path.join(dir, e.name), childRel);
      } else if (e.isFile() && e.name.endsWith('.enc')) {
        out.push(childRel);
      }
    }
  }
  await walk(root, '');
  return out.sort();
}

type Reader = (rel: string) => Promise<unknown>;

function arrayAt(value: unknown, key: string | null, source: string): unknown[] {
  const list = key === null ? value : (value as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(list)) throw new FileImportError(`${source}: expected ${key ? `"${key}" ` : ''}array`);
  return list;
}

function elementId(el: unknown, source: string, index: number): string {
  const id = (el as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !isSafeId(id)) throw new FileImportError(`${source}[${index}]: missing or invalid id`);
  return id;
}

/**
 * Map one `.enc` file to its rows. Returns null when the path matches no known
 * layout (→ unclaimed).
 */
async function planFile(rel: string, read: Reader): Promise<PlannedRow[] | null> {
  const p = rel.split('/');
  const one = async (table: SQLiteTable, keys: Keys): Promise<PlannedRow[]> => [
    { table, keys, doc: await read(rel), source: rel },
  ];
  const list = async (
    table: SQLiteTable,
    scope: Keys,
    key: string | null,
    rowKeys: (el: unknown, i: number) => Keys,
  ): Promise<PlannedRow[]> =>
    arrayAt(await read(rel), key, rel).map((el, i) => ({
      table,
      keys: { ...scope, ...rowKeys(el, i), seq: i },
      doc: el,
      source: `${rel}[${i}]`,
    }));

  if (p.length === 1 && p[0] === 'app-settings.enc') return one(appSettings, { id: 'app' });

  if (p[0] === 'users' && p.length >= 3 && isSafeId(p[1])) {
    const userId = p[1];
    const [, , a, b, c, d] = p;
    if (p.length === 3 && a === 'preferences.enc') return one(userPreferences, { userId });

    // users/U/{accounts,investments,...}/{id}.enc
    if (p.length === 4 && USER_DOCS[a] && encId(b)) return one(USER_DOCS[a], { userId, id: encId(b)! });

    // users/U/accounts/A/{recurring,planned,salary,taxed-income}/{id}.enc
    if (p.length === 6 && a === 'accounts' && isSafeId(b) && ACCOUNT_CHILDREN[c] && encId(d)) {
      return one(ACCOUNT_CHILDREN[c], { userId, accountId: b, id: encId(d)! });
    }
    if (p.length === 6 && a === 'investments' && isSafeId(b) && c === 'contributions' && encId(d)) {
      return one(investmentContribution, { userId, investmentId: b, id: encId(d)! });
    }
    if (p.length === 6 && a === 'debts' && isSafeId(b) && DEBT_CHILDREN[c] && encId(d)) {
      return one(DEBT_CHILDREN[c], { userId, debtId: b, id: encId(d)! });
    }
    if (p.length === 6 && a === 'receivables' && isSafeId(b) && c === 'repayments' && encId(d)) {
      return one(receivableRepayment, { userId, receivableId: b, id: encId(d)! });
    }

    // users/U/reconciliation/{balance-snapshots,reconciliation-adjustments,reconciliation-sessions}.enc
    if (p.length === 4 && a === 'reconciliation' && RECONCILIATION_FILES[b]) {
      const { table, key } = RECONCILIATION_FILES[b];
      return list(table, { userId }, key, (el, i) => ({ id: elementId(el, rel, i) }));
    }

    if (a === 'bank') {
      // users/U/bank/connections/{id}.session.enc | {id}.enc
      if (p.length === 5 && b === 'connections' && encId(c, '.session.enc')) {
        return one(bankSessionSecret, { userId, connectionId: encId(c, '.session.enc')! });
      }
      if (p.length === 5 && b === 'connections' && encId(c)) return one(bankConnection, { userId, id: encId(c)! });
      // users/U/bank/accounts/L/transactions.enc
      if (p.length === 6 && b === 'accounts' && isSafeId(c) && d === 'transactions.enc') {
        return list(bankTransaction, { userId, linkedAccountId: c }, 'transactions', () => ({}));
      }
      // users/U/bank/sync-runs/{connectionId}.enc
      if (p.length === 5 && b === 'sync-runs' && encId(c)) {
        return list(bankSyncRun, { userId, connectionId: encId(c)! }, 'runs', () => ({}));
      }
    }
    return null;
  }

  if (p[0] === 'shared') {
    const [, a, b, c, d] = p;
    if (p.length === 3 && a === 'mortgages' && encId(b)) return one(mortgage, { id: encId(b)! });
    if (p.length === 5 && a === 'mortgages' && isSafeId(b) && MORTGAGE_CHILDREN[c] && encId(d)) {
      return one(MORTGAGE_CHILDREN[c], { mortgageId: b, id: encId(d)! });
    }
    if (p.length === 3 && a === 'mortgage-members' && encId(b)) {
      return list(mortgageMemberIndex, { userId: encId(b)! }, 'mortgageIds', (el, i) => ({
        mortgageId: indexId(el, rel, i),
      }));
    }
    if (p.length === 3 && a === 'split-groups' && encId(b)) return one(splitGroup, { id: encId(b)! });
    if (p.length === 4 && a === 'split-groups' && isSafeId(b) && c === 'summary.enc') {
      return one(splitGroupSummary, { groupId: b });
    }
    if (p.length === 5 && a === 'split-groups' && isSafeId(b) && c === 'expenses' && d.endsWith('.enc')) {
      const ym = d.slice(0, -'.enc'.length);
      if (!isChunkMonth(ym)) return null;
      return list(splitExpense, { groupId: b, yearMonth: ym }, null, (el, i) => ({ id: elementId(el, rel, i) }));
    }
    if (p.length === 3 && a === 'split-group-members' && encId(b)) {
      return list(splitGroupMemberIndex, { userId: encId(b)! }, 'groupIds', (el, i) => ({
        groupId: indexId(el, rel, i),
      }));
    }
  }
  return null;
}

function indexId(el: unknown, source: string, index: number): string {
  if (typeof el !== 'string' || !isSafeId(el)) throw new FileImportError(`${source}[${index}]: invalid id`);
  return el;
}

function readMarker(): string | null {
  const row = getDb().select().from(meta).where(eq(meta.key, FILE_IMPORT_META_KEY)).get();
  return row?.value ?? null;
}

export function isFileDataImported(): boolean {
  return readMarker() !== null;
}

/** Import the `.enc` tree once (see module doc). Throws `FileImportError` on any inconsistency. */
export async function importFileData(): Promise<FileImportResult> {
  const previous = readMarker();
  if (previous !== null) {
    const summary = JSON.parse(previous) as Omit<FileImportResult, 'status'>;
    return { ...summary, status: 'already-imported' };
  }

  const root = getDataDir();
  const files = (await walkEncFiles(root)).filter((rel) => !LEGACY_USER_FILES.some((re) => re.test(rel)));

  // Rows without a marker are fine on a fresh install (nothing to import, e.g.
  // a seeded test instance); with `.enc` files present they would be mixed.
  const nonEmpty = FINANCE_TABLES.filter((t) => countRows(t) > 0).map((t) => getTableName(t));
  if (files.length > 0 && nonEmpty.length > 0) {
    throw new FileImportError(
      `no import marker, but finance tables already hold rows (${nonEmpty.join(', ')}); refusing to mix data`,
    );
  }

  const read: Reader = async (rel) => {
    let value: unknown;
    try {
      value = await readEncryptedFile<unknown>(path.join(root, rel));
    } catch (error) {
      throw new FileImportError(`${rel} is unreadable (wrong ENCRYPTION_KEY?): ${(error as Error).message}`);
    }
    if (value === null) throw new FileImportError(`${rel} vanished during the import`);
    return value;
  };

  const planned: PlannedRow[] = [];
  const unclaimed: string[] = [];
  for (const rel of files) {
    const rows = await planFile(rel, read);
    if (rows === null) unclaimed.push(rel);
    else planned.push(...rows);
  }
  if (unclaimed.length > 0) {
    throw new FileImportError(`unrecognised .enc file(s), nothing imported: ${unclaimed.join(', ')}`);
  }

  const byTable: Record<string, number> = {};
  for (const r of planned) {
    const name = getTableName(r.table);
    byTable[name] = (byTable[name] ?? 0) + 1;
  }
  const result: FileImportResult = { status: 'imported', files: files.length, rows: planned.length, byTable };

  inTx(() => {
    for (const r of planned) {
      try {
        insertDoc(r.table, r.keys, r.doc);
      } catch (error) {
        throw new FileImportError(`${r.source}: ${(error as Error).message}`);
      }
    }

    // Verify: every row reads back exactly as its source, and nothing else is there.
    for (const r of planned) {
      const stored = getRawData(r.table, r.keys);
      if (stored === undefined) throw new FileImportError(`${r.source}: row missing after insert`);
      // Key-only index rows (no `data` column) are verified by existence; their
      // id is part of the primary key.
      if (stored !== null && JSON.stringify(JSON.parse(stored)) !== JSON.stringify(r.doc)) {
        throw new FileImportError(`${r.source}: stored row differs from the file`);
      }
    }
    for (const t of files.length > 0 ? FINANCE_TABLES : []) {
      const name = getTableName(t);
      if (countRows(t) !== (byTable[name] ?? 0)) {
        throw new FileImportError(`${name}: ${countRows(t)} rows stored, ${byTable[name] ?? 0} expected`);
      }
    }

    const summary = { files: result.files, rows: result.rows, byTable, at: new Date().toISOString() };
    getDb()
      .insert(meta)
      .values({ key: FILE_IMPORT_META_KEY, value: JSON.stringify(summary), updatedAt: new Date() })
      .run();
  });

  return result;
}
