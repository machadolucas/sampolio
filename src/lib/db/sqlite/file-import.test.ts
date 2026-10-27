import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTempDataDir } from '@/test/temp-data-dir';
import { encrypt, writeEncryptedFile } from '../encryption';
import { closeDb, getDb } from './client';
import { countRows, putDoc } from './docs';
import { bootstrapDatabase } from './bootstrap';
import { clearSetupFailure, getSetupFailure } from './setup-state';
import { FileImportError, importFileData, isFileDataImported } from './file-import';
import { FINANCE_TABLES, goal as goalTable } from './schema';
import { getAccounts } from '../accounts';
import { getRecurringItems } from '../recurring-items';
import { getPlannedItems } from '../planned-items';
import { getSalaryConfigs } from '../salary-configs';
import { getTaxedIncomes } from '../taxed-income';
import { getContributions, getInvestmentAccounts } from '../investments';
import { getDebts, getExtraPayments, getReferenceRates } from '../debts';
import { getReceivables, getRepayments } from '../receivables';
import { getBudgets } from '../budgets';
import { getGoals } from '../goals';
import { getTrips } from '../trips';
import { getAllAdjustments, getBalanceSnapshots, getReconciliationSessions } from '../reconciliation';
import { getBankConnections, getBankSessionSecret } from '../bank-connections';
import { getBankTransactions } from '../bank-transactions';
import { getBankSyncRuns } from '../bank-sync-runs';
import { getActuals, getMortgageById, getMortgageIdsForUser, getRates } from '../shared-mortgages';
import {
  getExpenseMonths,
  getExpensesForMonth,
  getSplitGroupById,
  getSplitGroupIdsForUser,
  getSplitGroupSummary,
} from '../split-groups';
import { getUserPreferences } from '../user-preferences';
import { getAppSettings } from '../app-settings';

const ALEX = 'alex';
const SAM = 'sam';
const T = '2026-01-01T00:00:00.000Z';

let tmp: ReturnType<typeof useTempDataDir>;

beforeEach(() => {
  closeDb();
  tmp = useTempDataDir('sampolio-file-import-');
});

afterEach(() => {
  closeDb();
  clearSetupFailure();
  vi.restoreAllMocks();
  tmp.cleanup();
});

const put = (rel: string, data: unknown) => writeEncryptedFile(path.join(tmp.dir, rel), data);

/** A synthetic file-era tree covering every layout the importer claims. */
async function seedTree() {
  const src = {
    prefs: { hasCompletedOnboarding: true, customCategories: ['Pets'], updatedAt: T },
    account: { id: 'acc-1', userId: ALEX, name: 'Main', currency: 'EUR', startingBalance: 100, createdAt: T, updatedAt: T },
    recurring: { id: 'rec-1', accountId: 'acc-1', name: 'Rent', amount: 900, legacyField: 'kept', createdAt: T, updatedAt: T },
    orphan: { id: 'rec-orphan', accountId: 'acc-gone', name: 'Orphan', amount: 1, createdAt: T, updatedAt: T },
    planned: { id: 'pl-1', accountId: 'acc-1', name: 'Trip', scheduledDate: '2026-05', createdAt: T, updatedAt: T },
    salary: { id: 'sal-1', accountId: 'acc-1', name: 'Job', isActive: true, benefits: [{ name: 'Phone', amount: 20 }], createdAt: T, updatedAt: T },
    taxed: { id: 'ti-1', accountId: 'acc-1', name: 'Bonus', createdAt: T, updatedAt: T },
    investment: { id: 'inv-1', userId: ALEX, name: 'Fund', createdAt: T, updatedAt: T },
    contribution: { id: 'c-1', investmentAccountId: 'inv-1', amount: 50, createdAt: T, updatedAt: T },
    debt: { id: 'debt-1', userId: ALEX, name: 'Car', createdAt: T, updatedAt: T },
    rate: { id: 'r-1', debtId: 'debt-1', yearMonth: '2026-01', rate: 3.1, createdAt: T },
    payment: { id: 'p-1', debtId: 'debt-1', date: '2026-02-01', amount: 100, createdAt: T },
    receivable: { id: 'rcv-1', userId: ALEX, name: 'Loan to Sam', initialPrincipal: 500, currentBalance: 500, createdAt: T, updatedAt: T },
    repayment: { id: 'rp-1', receivableId: 'rcv-1', date: '2026-03-01', amount: 200, createdAt: T },
    budget: { id: 'b-1', userId: ALEX, name: 'Holiday', startMonth: '2026-06', lines: [{ id: 'l-1' }], fundingSources: [], expenseEntries: [] },
    goal: { id: 'g-1', userId: ALEX, name: 'Buffer', createdAt: T, updatedAt: T },
    trip: { id: 't-1', userId: ALEX, name: 'Berlin', startDateTime: '2026-05-04T07:00', days: [], rates: { countryRates: { DE: 69 } } },
    snapshots: [
      { id: 's-2', userId: ALEX, entityType: 'cash-account', entityId: 'acc-1', yearMonth: '2026-02', variance: 0 },
      { id: 's-1', userId: ALEX, entityType: 'cash-account', entityId: 'acc-1', yearMonth: '2026-01', variance: 0 },
    ],
    adjustments: [{ id: 'adj-1', snapshotId: 's-1', category: 'other', amount: 3 }],
    sessions: [{ id: 'sess-1', userId: ALEX, yearMonth: '2026-01', status: 'completed', snapshots: [], adjustments: [] }],
    connection: { id: 'conn-1', userId: ALEX, aspspName: 'Bank', linkedAccounts: [{ id: 'link-1' }], createdAt: T, updatedAt: T },
    secret: { connectionId: 'conn-1', sessionId: 'secret-session', state: 'st' },
    transactions: [
      { id: 'tx-1', dedupKey: 'k', amount: -5 },
      { id: 'tx-2', dedupKey: 'k', amount: -5 }, // identical #occN rows are legitimate
      { id: 'tx-3', dedupKey: 'k3', amount: 7 },
    ],
    runs: [{ id: 'run-2', status: 'ok', perAccount: [] }, { id: 'run-1', status: 'error', perAccount: [] }],
    mortgage: { id: 'm-1', name: 'Home', loans: [], members: [{ userId: ALEX }, { userId: SAM }], createdAt: T, updatedAt: T },
    mortgageRate: { id: 'mr-1', mortgageId: 'm-1', effectiveDate: '2025-12', euriborRate: 2.3 },
    actual: { id: 'ac-1', mortgageId: 'm-1', loanId: 'loan-1', yearMonth: '2026-01', remaining: 1000 },
    group: { id: 'grp-1', name: 'Household', members: [{ userId: ALEX }, { userId: SAM }], recurrenceRules: [], createdAt: T },
    expenses: [
      { id: 'e-2', kind: 'expense', date: '2026-09-20', netByUserId: { [ALEX]: 5, [SAM]: -5 }, createdAt: T },
      { id: 'e-1', kind: 'payment', date: '2026-09-02', netByUserId: { [ALEX]: -5, [SAM]: 5 }, createdAt: T },
    ],
    summary: { groupId: 'grp-1', netByUserId: {}, expenseCount: 1, paymentCount: 1, monthsWithData: ['2026-09'] },
    settings: { selfSignupEnabled: true, updatedAt: T, updatedBy: 'admin' },
  };
  const u = `users/${ALEX}`;
  await put(`${u}/preferences.enc`, src.prefs);
  await put(`${u}/accounts/acc-1.enc`, src.account);
  await put(`${u}/accounts/acc-1/recurring/rec-1.enc`, src.recurring);
  await put(`${u}/accounts/acc-gone/recurring/rec-orphan.enc`, src.orphan);
  await put(`${u}/accounts/acc-1/planned/pl-1.enc`, src.planned);
  await put(`${u}/accounts/acc-1/salary/sal-1.enc`, src.salary);
  await put(`${u}/accounts/acc-1/taxed-income/ti-1.enc`, src.taxed);
  await put(`${u}/investments/inv-1.enc`, src.investment);
  await put(`${u}/investments/inv-1/contributions/c-1.enc`, src.contribution);
  await put(`${u}/debts/debt-1.enc`, src.debt);
  await put(`${u}/debts/debt-1/reference-rates/r-1.enc`, src.rate);
  await put(`${u}/debts/debt-1/extra-payments/p-1.enc`, src.payment);
  await put(`${u}/receivables/rcv-1.enc`, src.receivable);
  await put(`${u}/receivables/rcv-1/repayments/rp-1.enc`, src.repayment);
  await put(`${u}/budgets/b-1.enc`, src.budget);
  await put(`${u}/trips/t-1.enc`, src.trip);
  await put(`${u}/reconciliation/balance-snapshots.enc`, { snapshots: src.snapshots });
  await put(`${u}/reconciliation/reconciliation-adjustments.enc`, { adjustments: src.adjustments });
  await put(`${u}/reconciliation/reconciliation-sessions.enc`, { sessions: src.sessions });
  await put(`${u}/bank/connections/conn-1.enc`, src.connection);
  await put(`${u}/bank/connections/conn-1.session.enc`, src.secret);
  await put(`${u}/bank/accounts/link-1/transactions.enc`, { transactions: src.transactions });
  await put(`${u}/bank/sync-runs/conn-1.enc`, { runs: src.runs });
  await put('shared/mortgages/m-1.enc', src.mortgage);
  await put('shared/mortgages/m-1/rates/mr-1.enc', src.mortgageRate);
  await put('shared/mortgages/m-1/actuals/ac-1.enc', src.actual);
  await put(`shared/mortgage-members/${ALEX}.enc`, { mortgageIds: ['m-1'] });
  await put('shared/split-groups/grp-1.enc', src.group);
  await put('shared/split-groups/grp-1/expenses/2026-09.enc', src.expenses);
  await put('shared/split-groups/grp-1/summary.enc', src.summary);
  await put(`shared/split-group-members/${SAM}.enc`, { groupIds: ['grp-1'] });
  await put('app-settings.enc', src.settings);
  // An older pretty-printed file still imports (parsing is whitespace-agnostic).
  fs.mkdirSync(path.join(tmp.dir, u, 'goals'), { recursive: true });
  fs.writeFileSync(path.join(tmp.dir, u, 'goals', 'g-1.enc'), encrypt(JSON.stringify(src.goal, null, 2)));
  // Ignored: pre-4.0 user records, avatars, dot-files, SQLite snapshots.
  await put('users-index.enc', { users: [] });
  await put(`${u}/user.enc`, { id: ALEX });
  fs.writeFileSync(path.join(tmp.dir, u, 'avatar.webp'), 'img');
  fs.writeFileSync(path.join(tmp.dir, '.encryption_key'), 'not-the-key');
  return src;
}

const totalRows = () => FINANCE_TABLES.reduce((n, t) => n + countRows(t), 0);

describe('importFileData', () => {
  it('imports every layout; the DB modules return exactly the file contents, in order', async () => {
    const src = await seedTree();

    const result = await importFileData();
    expect(result.status).toBe('imported');
    expect(result.files).toBe(33);
    expect(result.rows).toBe(totalRows());
    expect(isFileDataImported()).toBe(true);

    expect(await getUserPreferences(ALEX)).toEqual(src.prefs);
    expect(await getAccounts(ALEX)).toEqual([src.account]);
    expect(await getRecurringItems(ALEX, 'acc-1')).toEqual([src.recurring]);
    expect(await getRecurringItems(ALEX, 'acc-gone')).toEqual([src.orphan]);
    expect(await getPlannedItems(ALEX, 'acc-1')).toEqual([src.planned]);
    expect(await getSalaryConfigs(ALEX, 'acc-1')).toEqual([src.salary]);
    expect(await getTaxedIncomes(ALEX, 'acc-1')).toEqual([src.taxed]);
    expect(await getInvestmentAccounts(ALEX)).toEqual([src.investment]);
    expect(await getContributions(ALEX, 'inv-1')).toEqual([src.contribution]);
    expect(await getDebts(ALEX)).toEqual([src.debt]);
    expect(await getReferenceRates(ALEX, 'debt-1')).toEqual([src.rate]);
    expect(await getExtraPayments(ALEX, 'debt-1')).toEqual([src.payment]);
    expect(await getReceivables(ALEX)).toEqual([{ ...src.receivable, currentBalance: 300 }]);
    expect(await getRepayments(ALEX, 'rcv-1')).toEqual([src.repayment]);
    expect(await getBudgets(ALEX)).toEqual([src.budget]);
    expect(await getGoals(ALEX)).toEqual([src.goal]);
    expect(await getTrips(ALEX)).toEqual([src.trip]);
    expect(await getBalanceSnapshots(ALEX)).toEqual(src.snapshots); // file order kept
    expect(await getAllAdjustments(ALEX)).toEqual(src.adjustments);
    expect(await getReconciliationSessions(ALEX)).toEqual(src.sessions);
    expect(await getBankConnections(ALEX)).toEqual([src.connection]);
    expect(await getBankSessionSecret(ALEX, 'conn-1')).toEqual(src.secret);
    expect(await getBankTransactions(ALEX, 'link-1')).toEqual(src.transactions);
    expect(await getBankSyncRuns(ALEX, 'conn-1')).toEqual(src.runs);
    expect(await getMortgageById('m-1')).toEqual(src.mortgage);
    expect(await getRates('m-1')).toEqual([src.mortgageRate]);
    expect(await getActuals('m-1')).toEqual([src.actual]);
    expect(await getMortgageIdsForUser(ALEX)).toEqual(['m-1']);
    expect(await getMortgageIdsForUser(SAM)).toEqual([]); // the index is imported as stored
    expect(await getSplitGroupById('grp-1')).toEqual(src.group);
    expect(await getExpenseMonths('grp-1')).toEqual(['2026-09']);
    expect(await getExpensesForMonth('grp-1', '2026-09')).toEqual(src.expenses); // chunk order kept
    expect(await getSplitGroupSummary('grp-1')).toEqual(src.summary);
    expect(await getSplitGroupIdsForUser(SAM)).toEqual(['grp-1']);
    expect(await getAppSettings()).toEqual(src.settings);

    // The files are never touched.
    expect(fs.existsSync(path.join(tmp.dir, 'users', ALEX, 'accounts', 'acc-1.enc'))).toBe(true);
  });

  it('runs once: a second run is a no-op that reports the first', async () => {
    await seedTree();
    const first = await importFileData();
    const rows = totalRows();
    const second = await importFileData();
    expect(second).toMatchObject({ status: 'already-imported', rows: first.rows, files: first.files });
    expect(totalRows()).toBe(rows);
  });

  it('aborts on an unrecognised .enc file and writes nothing', async () => {
    await put(`users/${ALEX}/goals/g-1.enc`, { id: 'g-1' });
    await put(`users/${ALEX}/mystery/thing.enc`, { x: 1 });
    await expect(importFileData()).rejects.toThrow(/unrecognised .*mystery\/thing\.enc/);
    expect(totalRows()).toBe(0);
    expect(isFileDataImported()).toBe(false);
  });

  it('aborts on an unreadable file (wrong key / corrupt) and writes nothing', async () => {
    await put(`users/${ALEX}/goals/g-1.enc`, { id: 'g-1' });
    fs.writeFileSync(path.join(tmp.dir, 'users', ALEX, 'goals', 'g-2.enc'), 'not ciphertext');
    await expect(importFileData()).rejects.toThrow(/g-2\.enc is unreadable/);
    expect(totalRows()).toBe(0);
  });

  it('aborts on a key collision instead of merging rows', async () => {
    await put(`users/${ALEX}/reconciliation/balance-snapshots.enc`, {
      snapshots: [{ id: 'dup' }, { id: 'dup' }],
    });
    await expect(importFileData()).rejects.toThrow(FileImportError);
    expect(totalRows()).toBe(0);
    expect(isFileDataImported()).toBe(false);
  });

  it('refuses to mix: rows already present without the marker while files exist', async () => {
    await put(`users/${ALEX}/goals/g-1.enc`, { id: 'g-1' });
    putDoc(goalTable, { userId: ALEX, id: 'g-x' }, { id: 'g-x' });
    await expect(importFileData()).rejects.toThrow(/refusing to mix/);
    expect(isFileDataImported()).toBe(false);
  });

  it('a fresh install (no .enc files) just records the marker, keeping seeded rows', async () => {
    putDoc(goalTable, { userId: ALEX, id: 'g-x' }, { id: 'g-x' });
    expect(await importFileData()).toMatchObject({ status: 'imported', files: 0, rows: 0 });
    expect(await getGoals(ALEX)).toEqual([{ id: 'g-x' }]);
    expect((await importFileData()).status).toBe('already-imported');
  });
});

describe('bootstrap', () => {
  it('fails closed with dataReady=false when the import aborts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // An existing install: the DB (auth) predates this boot, so it is kept.
    getDb();
    closeDb();
    await put('shared/unknown/x.enc', { x: 1 });
    const result = await bootstrapDatabase();
    expect(result).toMatchObject({ ok: false, dbUsable: true, dataReady: false });
    expect(getSetupFailure()?.message).toMatch(/File data import aborted/);
  });

  it('imports during a normal boot', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await put('app-settings.enc', { selfSignupEnabled: false, updatedAt: T, updatedBy: 'x' });
    const result = await bootstrapDatabase();
    expect(result).toEqual({ ok: true, dbUsable: true, dbDiscarded: false, dataReady: true });
    expect((await getAppSettings()).updatedBy).toBe('x');
  });
});
