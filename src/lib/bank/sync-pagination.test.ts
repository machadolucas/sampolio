import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { BankAccountLink, BankConnection, BankTransaction } from '@/types';
import { creditCardRefreshFloor, runSync } from './sync';
import { BankApiError, getAccountTransactions, getAccountBalances } from './client';
import { getBankConnectionById, getBankConnections, getBankSessionSecret, updateBankConnection } from '@/lib/db/bank-connections';
import { getBankTransactions, writeBankTransactions } from '@/lib/db/bank-transactions';
import { getAllUsers } from '@/lib/db/users';
import { getAccountById } from '@/lib/db/accounts';
import { getRecurringItems } from '@/lib/db/recurring-items';
import { getPlannedItems } from '@/lib/db/planned-items';
import { getTaxedIncomes } from '@/lib/db/taxed-income';
import { createBalanceSnapshot, getLatestSnapshot } from '@/lib/db/reconciliation';
import { createMockAccount, createMockSnapshot } from '@/test/mocks';
import { TRANSIENT_BACKOFF_MS } from './constants';

vi.mock('./client', async (importOriginal) => ({
  ...await importOriginal<typeof import('./client')>(),
  getAccountTransactions: vi.fn(), getAccountBalances: vi.fn(), getSession: vi.fn(),
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn() }));
vi.mock('@/lib/db/bank-connections', () => ({
  getBankConnectionById: vi.fn(), getBankConnections: vi.fn(),
  getBankSessionSecret: vi.fn(), updateBankConnection: vi.fn(),
}));
vi.mock('@/lib/db/bank-transactions', () => ({ getBankTransactions: vi.fn(), writeBankTransactions: vi.fn() }));
vi.mock('@/lib/db/bank-sync-runs', () => ({ appendBankSyncRun: vi.fn() }));
vi.mock('@/lib/db/users', () => ({ getAllUsers: vi.fn() }));
// No financial-account anchor is configured; all persistence/network boundaries
// used by these scenarios are mocks, so tests never open a real bank ledger.
vi.mock('@/lib/db/accounts', () => ({ getAccountById: vi.fn() }));
vi.mock('@/lib/db/recurring-items', () => ({ getRecurringItems: vi.fn() }));
vi.mock('@/lib/db/planned-items', () => ({ getPlannedItems: vi.fn() }));
vi.mock('@/lib/db/taxed-income', () => ({ getTaxedIncomes: vi.fn() }));
vi.mock('@/lib/db/reconciliation', () => ({ getLatestSnapshot: vi.fn(), createBalanceSnapshot: vi.fn() }));

const nowIso = '2026-09-09T10:00:00.000Z';
const now = Date.parse(nowIso);
function link(id: string, connectionId: string, role: BankAccountLink['accountRole'] = 'cash'): BankAccountLink {
  return {
    id, connectionId, accountUid: `uid-${id}`, currency: 'EUR', accountRole: role,
    identificationHash: 'shared-hash', identificationHashes: ['shared-hash'],
    syncCursor: { lastBookingDate: '2026-09-07' },
  };
}
function connection(id: string, userId: string, account: BankAccountLink): BankConnection {
  return { id, userId, aspspName: 'Test Bank', aspspCountry: 'FI', status: 'active',
    psuType: 'personal', linkedAccounts: [account], createdAt: nowIso, updatedAt: nowIso };
}
function storedPending(linkedAccountId: string): BankTransaction {
  return { id: `hold-${linkedAccountId}`, linkedAccountId, dedupKey: 'stored-hold',
    bookingDate: '2026-09-08', amount: -17, currency: 'EUR', status: 'pending',
    firstSeenAt: '2026-09-08T10:00:00Z', lastSeenAt: '2026-09-08T10:00:00Z' };
}
function rawTx(ref: string, status = 'BOOK') {
  return { entry_reference: ref, transaction_amount: { amount: '42', currency: 'EUR' },
    credit_debit_indicator: 'DBIT', status, booking_date: '2026-09-09' };
}
/** A card purchase at a generic merchant, as the bank delivers it. */
function cafeTx(ref: string, status = 'BOOK') {
  return { ...rawTx(ref, status), creditor_name: 'Corner Cafe' };
}
/** A stored row identical to what `cafeTx` maps to (same identity group). */
function storedCafe(id: string, dedupKey: string, status: BankTransaction['status']): BankTransaction {
  return { id, linkedAccountId: 'account-a', dedupKey, entryReference: 'p-1',
    bookingDate: '2026-09-09', amount: -42, currency: 'EUR', status, counterpartyName: 'Corner Cafe',
    firstSeenAt: '2026-09-09T08:00:00Z', lastSeenAt: '2026-09-09T08:00:00Z' };
}
let primary: BankConnection;
let sibling: BankConnection;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  primary = connection('primary', 'alex', link('account-a', 'primary'));
  sibling = connection('sibling', 'sam', link('account-b', 'sibling'));
  vi.mocked(getBankConnectionById).mockResolvedValue(primary);
  vi.mocked(getBankSessionSecret).mockResolvedValue({ connectionId: primary.id, state: 'test', sessionId: 'session', createdAt: nowIso });
  vi.mocked(getAllUsers).mockResolvedValue([]);
  vi.mocked(getBankTransactions).mockImplementation(async (_user, accountId) => [storedPending(accountId)]);
  vi.mocked(getAccountBalances).mockResolvedValue({ balances: [] });
});
afterEach(() => { vi.restoreAllMocks(); });
function enableSibling() {
  // Only the user id is read by fan-out; return complete synthetic user records.
  vi.mocked(getAllUsers).mockResolvedValue([{ id: 'sam', name: 'Sam', email: 'sam@example.com',
    role: 'user', isActive: true, createdAt: nowIso, updatedAt: nowIso }]);
  vi.mocked(getBankConnections).mockResolvedValue([sibling]);
}
function writtenRows(accountId: string) {
  return vi.mocked(writeBankTransactions).mock.calls.find((call) => call[1] === accountId)?.[2];
}

describe('runSync pagination persistence', () => {
  it('extends only credit-card refreshes through the latest closed cycle', () => {
    expect(creditCardRefreshFloor('2026-09-20', 13)).toBe('2026-08-13');
    expect(creditCardRefreshFloor('2026-09-10', 13)).toBe('2026-07-13');
    expect(creditCardRefreshFloor('2026-09-20')).toBeUndefined();
  });

  it('uses the extended cycle window for cards while leaving cash on its overlap', async () => {
    primary = connection('primary', 'alex', link('card-a', 'primary', 'credit-card'));
    primary.linkedAccounts[0].statementDay = 13;
    primary.linkedAccounts[0].syncCursor = { lastBookingDate: '2026-09-07', backfilledThrough: '2026-09-08' };
    vi.mocked(getBankConnectionById).mockResolvedValue(primary);
    vi.mocked(getAccountTransactions).mockResolvedValue({ transactions: [rawTx('card-row')] });
    await runSync('alex', 'primary', 'manual', {}, now);
    expect(vi.mocked(getAccountTransactions).mock.calls[0][1]).toMatchObject({ dateFrom: '2026-07-13' });

    vi.clearAllMocks();
    primary = connection('primary', 'alex', link('cash-a', 'primary'));
    primary.linkedAccounts[0].syncCursor = { lastBookingDate: '2026-09-07', backfilledThrough: '2026-09-08' };
    vi.mocked(getBankConnectionById).mockResolvedValue(primary);
    vi.mocked(getAccountTransactions).mockResolvedValue({ transactions: [rawTx('cash-row')] });
    await runSync('alex', 'primary', 'manual', {}, now);
    expect(vi.mocked(getAccountTransactions).mock.calls[0][1]).toMatchObject({ dateFrom: '2026-09-04' });
  });

  it.each(['network', 'cycle', 'limit', 'malformed'] as const)(
    'does not persist or fan out an incomplete booked fetch (%s)', async (failure) => {
      enableSibling();
      let page = 0;
      vi.mocked(getAccountTransactions).mockImplementation(async () => {
        page++;
        if (page === 1) return { transactions: [rawTx('partial-booked')], continuation_key: 'next' };
        if (failure === 'network') throw new BankApiError('TRANSIENT', 'Synthetic network failure');
        if (failure === 'malformed') return {};
        return { transactions: [], continuation_key: failure === 'cycle' ? 'next' : `page-${page}` };
      });
      const run = await runSync('alex', 'primary', 'manual', {}, now);
      expect(run.status).toBe('error');
      expect(run.perAccount[0].error).toBe(failure === 'network' ? 'TRANSIENT' : 'BAD_RESPONSE');
      expect(writeBankTransactions).not.toHaveBeenCalled();
      expect(getAccountBalances).not.toHaveBeenCalled();
      expect(getAllUsers).not.toHaveBeenCalled();
      expect(updateBankConnection).toHaveBeenCalledWith('alex', 'primary', expect.objectContaining({
        linkedAccounts: primary.linkedAccounts,
        nextSyncDueAt: new Date(now + TRANSIENT_BACKOFF_MS).toISOString(),
      }));
      expect(vi.mocked(getAccountTransactions).mock.calls).toHaveLength(failure === 'limit' ? 50 : 2);
    }
  );

  it.each(['network', 'cycle', 'limit', 'malformed'] as const)(
    'discards partial pending pages and preserves holds in primary and fan-out (%s)', async (failure) => {
      enableSibling();
      let pendingPage = 0;
      vi.mocked(getAccountTransactions).mockImplementation(async (_uid, query) => {
        if (query?.transactionStatus !== 'PDNG') return { transactions: [rawTx('complete-booked')] };
        pendingPage++;
        if (pendingPage === 1) return { transactions: [rawTx('partial-pending', 'PDNG')], continuation_key: 'next' };
        if (failure === 'network') throw new BankApiError('TRANSIENT', 'Synthetic network failure');
        if (failure === 'malformed') return { transactions: null };
        return { transactions: [], continuation_key: failure === 'cycle' ? 'next' : `page-${pendingPage}` };
      });
      const run = await runSync('alex', 'primary', 'manual', {}, now);
      expect(run.status).toBe('ok');
      expect(run.perAccount[0]).toMatchObject({ pendingFetchOk: false, txAdded: 1, txRemoved: 0 });
      expect(run.perAccount[0].pendingFetched).toBeUndefined();
      for (const accountId of ['account-a', 'account-b']) {
        const rows = writtenRows(accountId)!;
        expect(rows.map((t) => t.dedupKey).sort()).toEqual(['complete-booked', 'stored-hold']);
        expect(rows.find((t) => t.dedupKey === 'stored-hold')?.id).toBe(`hold-${accountId}`);
      }
      const updates = vi.mocked(updateBankConnection).mock.calls;
      expect(updates.find((c) => c[1] === 'primary')?.[2].linkedAccounts?.[0].syncCursor?.backfilledThrough).toBe('2026-09-09');
      expect(updates.find((c) => c[1] === 'sibling')?.[2].linkedAccounts?.[0].syncCursor?.backfilledThrough).toBeUndefined();
    }
  );

  it('prunes expired holds in primary and fan-out after a complete empty pending fetch', async () => {
    enableSibling();
    vi.mocked(getAccountTransactions).mockImplementation(async (_uid, query) => ({
      transactions: query?.transactionStatus === 'PDNG' ? [] : [rawTx('complete-booked')],
      continuation_key: null,
    }));
    const run = await runSync('alex', 'primary', 'manual', {}, now);
    expect(run.perAccount[0]).toMatchObject({ pendingFetchOk: true, pendingFetched: 0, txRemoved: 1 });
    for (const accountId of ['account-a', 'account-b']) {
      expect(writtenRows(accountId)?.map((t) => t.dedupKey)).toEqual(['complete-booked']);
    }
  });
});

describe('runSync repeated deliveries', () => {
  it('keeps one pending row when the plain and PDNG responses both deliver it (Nordea shape)', async () => {
    vi.mocked(getBankTransactions).mockResolvedValue([]);
    vi.mocked(getAccountTransactions).mockImplementation(async (_uid, query) => ({
      transactions: query?.transactionStatus === 'PDNG'
        ? [cafeTx('p-1', 'PDNG')]
        : [rawTx('a-1'), cafeTx('p-1', 'PDNG')],
    }));
    const run = await runSync('alex', 'primary', 'manual', {}, now);
    expect(run.perAccount[0]).toMatchObject({
      pendingFetchOk: true, pendingFetched: 1, duplicatesCollapsed: 1, txAdded: 2,
    });
    const rows = writtenRows('account-a')!;
    expect(rows.map((t) => `${t.dedupKey}:${t.status}`).sort()).toEqual(['a-1:booked', 'p-1:pending']);
  });

  it('collapses a booked row repeated across pages but keeps repeats within one page', async () => {
    vi.mocked(getBankTransactions).mockResolvedValue([]);
    vi.mocked(getAccountTransactions).mockImplementation(async (_uid, query) => {
      if (query?.transactionStatus === 'PDNG') return { transactions: [] };
      if (!query?.continuationKey) return { transactions: [cafeTx('r-1'), rawTx('x-1')], continuation_key: 'next' };
      return { transactions: [cafeTx('r-1')] };
    });
    const run = await runSync('alex', 'primary', 'manual', {}, now);
    expect(run.perAccount[0]).toMatchObject({ duplicatesCollapsed: 1, txAdded: 2 });
    expect(writtenRows('account-a')!.map((t) => t.dedupKey).sort()).toEqual(['r-1', 'x-1']);

    vi.clearAllMocks();
    vi.mocked(getAccountTransactions).mockImplementation(async (_uid, query) => ({
      transactions: query?.transactionStatus === 'PDNG' ? [] : [cafeTx('r-1'), cafeTx('r-1')],
    }));
    const genuine = await runSync('alex', 'primary', 'manual', {}, now);
    expect(genuine.perAccount[0].duplicatesCollapsed).toBeUndefined();
    expect(writtenRows('account-a')!.map((t) => t.dedupKey).sort()).toEqual(['r-1', 'r-1#occ2']);
  });

  it.each([
    ['a complete PDNG fetch', undefined],
    ['a plain response without a PDNG fetch', '2026-09-09T08:00:00.000Z'],
  ] as const)('drops a stored phantom pending slot after %s reports it once', async (_label, lastSyncedAt) => {
    primary.linkedAccounts[0].lastSyncedAt = lastSyncedAt;
    vi.mocked(getBankTransactions).mockResolvedValue([
      storedCafe('stored-p', 'p-1', 'pending'),
      storedCafe('stored-p-phantom', 'p-1#occ2', 'pending'),
    ]);
    vi.mocked(getAccountTransactions).mockImplementation(async (_uid, query) => ({
      // Without a PDNG fetch (gate closed) the Nordea-style plain response is
      // the only report of the pending row, and no prune window applies.
      transactions: query?.transactionStatus === 'PDNG' || lastSyncedAt ? [cafeTx('p-1', 'PDNG')] : [],
    }));
    const run = await runSync('alex', 'primary', 'manual', {}, now);
    expect(run.perAccount[0].pendingFetchOk).toBe(lastSyncedAt ? undefined : true);
    expect(run.perAccount[0]).toMatchObject({ txAdded: 0, txRemoved: 1 });
    const rows = writtenRows('account-a')!;
    expect(rows.map((t) => [t.id, t.dedupKey])).toEqual([['stored-p', 'p-1']]);
  });
});

describe('runSync auto-anchor provenance (R2-1)', () => {
  it('stores the balance type, the bank reference date and the write-time opening balance', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 9, 13, 0, 0)); // Sept 9, local
    try {
      primary = connection('primary', 'alex', { ...link('cash-a', 'primary'), linkedFinancialAccountId: 'acc' });
      primary.linkedAccounts[0].syncCursor = { lastBookingDate: '2026-09-07', backfilledThrough: '2026-09-08' };
      vi.mocked(getBankConnectionById).mockResolvedValue(primary);
      vi.mocked(getBankConnections).mockResolvedValue([primary]);
      // A tiny in-memory ledger so the auto-anchor reads what this sync wrote.
      const ledgers = new Map<string, BankTransaction[]>();
      vi.mocked(getBankTransactions).mockImplementation(async (_user, id) => ledgers.get(id) ?? []);
      vi.mocked(writeBankTransactions).mockImplementation(async (_user, id, rows) => {
        ledgers.set(id, rows);
      });
      // Today's €42 debit is booked, but the bank serves YESTERDAY's close.
      vi.mocked(getAccountTransactions).mockResolvedValue({ transactions: [rawTx('cash-row')] });
      vi.mocked(getAccountBalances).mockResolvedValue({
        balances: [{ balance_type: 'CLBD', reference_date: '2026-09-08', balance_amount: { amount: '958.00', currency: 'EUR' } }],
      });
      vi.mocked(getAccountById).mockResolvedValue(
        createMockAccount({ id: 'acc', startingDate: '2026-01', startingBalance: 0, planningHorizonMonths: 12 })
      );
      vi.mocked(getRecurringItems).mockResolvedValue([]);
      vi.mocked(getPlannedItems).mockResolvedValue([]);
      vi.mocked(getTaxedIncomes).mockResolvedValue([]);
      vi.mocked(getLatestSnapshot).mockResolvedValue(null);
      vi.mocked(createBalanceSnapshot).mockImplementation(async (userId, entityType, entityId, yearMonth, expected, actual, source) => ({
        id: 's1', userId, entityType, entityId, yearMonth, expectedBalance: expected, actualBalance: actual,
        variance: actual - expected, source, createdAt: new Date().toISOString(),
      }));

      await runSync('alex', 'primary', 'manual', {}, now);

      expect(createBalanceSnapshot).toHaveBeenCalledTimes(1);
      const args = vi.mocked(createBalanceSnapshot).mock.calls[0];
      expect(args.slice(1, 4)).toEqual(['cash-account', 'acc', '2026-09']);
      expect(args[5]).toBe(958);
      expect(args[6]).toBe('bank-sync');
      // The Sept 9 debit is after the Sept 8 close, so it is not netted out.
      expect(args[7]).toEqual({ balanceType: 'CLBD', balanceAsOf: '2026-09-08', monthStartBalance: 958 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('R5-3/R6-4: a historical available balance never becomes the anchor (its opening is only an estimate)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 9, 13, 0, 0)); // Sept 9, local
    try {
      primary = connection('primary', 'alex', { ...link('cash-a', 'primary'), linkedFinancialAccountId: 'acc' });
      primary.linkedAccounts[0].syncCursor = { lastBookingDate: '2026-09-07', backfilledThrough: '2026-09-08' };
      vi.mocked(getBankConnectionById).mockResolvedValue(primary);
      vi.mocked(getBankConnections).mockResolvedValue([primary]);
      const ledgers = new Map<string, BankTransaction[]>();
      vi.mocked(getBankTransactions).mockImplementation(async (_user, id) => ledgers.get(id) ?? []);
      vi.mocked(writeBankTransactions).mockImplementation(async (_user, id, rows) => {
        ledgers.set(id, rows);
      });
      vi.mocked(getAccountTransactions).mockResolvedValue({ transactions: [rawTx('cash-row')] });
      // Only an opening available balance: as of Sept 8, its pending set unknown.
      vi.mocked(getAccountBalances).mockResolvedValue({
        balances: [{ balance_type: 'OPAV', balance_amount: { amount: '900.00', currency: 'EUR' } }],
      });
      vi.mocked(getAccountById).mockResolvedValue(
        createMockAccount({ id: 'acc', startingDate: '2026-01', startingBalance: 0, planningHorizonMonths: 12 })
      );
      vi.mocked(getRecurringItems).mockResolvedValue([]);
      vi.mocked(getPlannedItems).mockResolvedValue([]);
      vi.mocked(getTaxedIncomes).mockResolvedValue([]);
      // Planned September opening €1,000 (manual check-in).
      vi.mocked(getLatestSnapshot).mockResolvedValue(
        createMockSnapshot({ entityId: 'acc', yearMonth: '2026-09', actualBalance: 1000, source: 'manual' })
      );
      vi.mocked(createBalanceSnapshot).mockImplementation(async (userId, entityType, entityId, yearMonth, expected, actual, source) => ({
        id: 's1', userId, entityType, entityId, yearMonth, expectedBalance: expected, actualBalance: actual,
        variance: actual - expected, source, createdAt: new Date().toISOString(),
      }));

      await runSync('alex', 'primary', 'manual', {}, now);

      // Holds that have since booked would be counted twice on top of an
      // estimated opening: keep the previous (manual) anchor instead.
      expect(vi.mocked(createBalanceSnapshot)).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
