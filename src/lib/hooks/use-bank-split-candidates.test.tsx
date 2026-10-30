// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMySplitLinkCandidates } from '@/lib/actions/split-groups';
import type { ApiResponse, BankTransaction, SplitLinkCandidate } from '@/types';
import { useBankSplitCandidates } from './use-bank-split-candidates';

vi.mock('@/lib/actions/split-groups', () => ({ getMySplitLinkCandidates: vi.fn() }));
const getCandidates = vi.mocked(getMySplitLinkCandidates);

function candidate(expenseId = 'expense-1', overrides: Partial<SplitLinkCandidate> = {}): SplitLinkCandidate {
  return {
    expenseId,
    groupId: 'alex-sam',
    groupName: 'Alex and Sam',
    title: 'Groceries',
    date: '2026-10-01',
    amountCents: 1200,
    currency: 'EUR',
    bankLink: { txId: `tx-${expenseId}`, linkedAccountId: 'account-alex', ownerUserId: 'alex' },
    ...overrides,
  };
}

function transaction(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: 'tx-1',
    linkedAccountId: 'account-alex',
    dedupKey: 'tx-1',
    bookingDate: '2026-10-02',
    amount: -12,
    currency: 'EUR',
    status: 'booked',
    firstSeenAt: '2026-10-02T10:00:00Z',
    lastSeenAt: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}

function deferredRead() {
  let resolve!: (value: ApiResponse<SplitLinkCandidate[]>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ApiResponse<SplitLinkCandidate[]>>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  getCandidates.mockReturnValueOnce(promise);
  return { resolve, reject };
}

const ledger = [transaction()];

describe('useBankSplitCandidates', () => {
  beforeEach(() => getCandidates.mockReset());
  afterEach(cleanup);

  it('keeps an acknowledged save through a delayed pre-save read and later omitted reads', async () => {
    const saved = candidate();
    const pending = deferredRead();
    const { result } = renderHook(() => useBankSplitCandidates());
    let loading!: Promise<void>;
    act(() => { loading = result.current.loadCandidatesFor('account-alex', ledger); });
    act(() => result.current.addConfirmedCandidate('account-alex', saved));
    expect(result.current.candidatesByLink['account-alex']).toEqual([saved]);
    await act(async () => {
      pending.resolve({ success: true, data: [saved] });
      await loading;
    });
    // Even an echo from a pre-save read cannot release the new save's protection.
    getCandidates.mockResolvedValueOnce({ success: true, data: [] });
    await act(() => result.current.loadCandidatesFor('account-alex', ledger));
    expect(result.current.candidatesByLink['account-alex']).toEqual([saved]);
  });

  it('only lets the latest per-account request release saved protection', async () => {
    const saved = candidate();
    const { result } = renderHook(() => useBankSplitCandidates());
    act(() => result.current.addConfirmedCandidate('account-alex', saved));
    const oldRead = deferredRead();
    let oldLoading!: Promise<void>;
    act(() => { oldLoading = result.current.loadCandidatesFor('account-alex', ledger); });
    const currentRead = deferredRead();
    let currentLoading!: Promise<void>;
    act(() => { currentLoading = result.current.loadCandidatesFor('account-alex', ledger); });
    await act(async () => {
      oldRead.resolve({ success: true, data: [saved] });
      await oldLoading;
      currentRead.resolve({ success: true, data: [] });
      await currentLoading;
    });
    expect(result.current.candidatesByLink['account-alex']).toEqual([saved]);
  });

  it('preserves server and saved candidates on both unsuccessful and rejected refreshes', async () => {
    const existing = candidate('existing');
    const saved = candidate('saved');
    getCandidates.mockResolvedValueOnce({ success: true, data: [existing] });
    const { result } = renderHook(() => useBankSplitCandidates());
    await act(() => result.current.loadCandidatesFor('account-alex', ledger));
    act(() => result.current.addConfirmedCandidate('account-alex', saved));
    getCandidates.mockResolvedValueOnce({ success: false, error: 'Unavailable' });
    await act(() => result.current.loadCandidatesFor('account-alex', ledger));
    expect(result.current.candidatesByLink['account-alex']).toEqual([existing, saved]);
    const pending = deferredRead();
    let loading!: Promise<void>;
    act(() => { loading = result.current.loadCandidatesFor('account-alex', ledger); });
    await act(async () => {
      pending.reject(new Error('Offline'));
      await loading;
    });
    expect(result.current.candidatesByLink['account-alex']).toEqual([existing, saved]);
  });

  it('releases a save when echoed so later server edits and deletion take effect', async () => {
    const saved = candidate();
    const echoed = { ...saved, title: 'Server title' };
    const laterEdit = { ...saved, title: 'Sam updated groceries', amountCents: 1800, bankLink: undefined };
    const { result } = renderHook(() => useBankSplitCandidates());
    act(() => result.current.addConfirmedCandidate('account-alex', saved));
    getCandidates.mockResolvedValueOnce({ success: true, data: [echoed] });
    await act(() => result.current.loadCandidatesFor('account-alex', ledger));
    expect(result.current.candidatesByLink['account-alex']).toEqual([echoed]);
    getCandidates.mockResolvedValueOnce({ success: true, data: [laterEdit] });
    await act(() => result.current.loadCandidatesFor('account-alex', ledger));
    expect(result.current.candidatesByLink['account-alex']).toEqual([laterEdit]);
    getCandidates.mockResolvedValueOnce({ success: true, data: [] });
    await act(() => result.current.loadCandidatesFor('account-alex', ledger));
    expect(result.current.candidatesByLink['account-alex']).toEqual([]);
  });

  it.each([
    ['unlinked heuristic', undefined],
    ['different transaction', { txId: 'old-tx', linkedAccountId: 'account-alex', ownerUserId: 'alex' }],
    ['different account', { txId: 'tx-expense-1', linkedAccountId: 'account-sam', ownerUserId: 'alex' }],
    ['different owner', { txId: 'tx-expense-1', linkedAccountId: 'account-alex', ownerUserId: 'sam' }],
  ] as const)('does not downgrade a confirmed bank link to a same-id %s row', async (_label, bankLink) => {
    const saved = candidate();
    const { result } = renderHook(() => useBankSplitCandidates());
    act(() => result.current.addConfirmedCandidate('account-alex', saved));
    getCandidates.mockResolvedValueOnce({ success: true, data: [candidate('expense-1', { bankLink })] });
    await act(() => result.current.loadCandidatesFor('account-alex', ledger));
    expect(result.current.candidatesByLink['account-alex']).toEqual([saved]);
    getCandidates.mockResolvedValueOnce({ success: true, data: [] });
    await act(() => result.current.loadCandidatesFor('account-alex', ledger));
    expect(result.current.candidatesByLink['account-alex']).toEqual([saved]);
  });

  it('isolates accounts and upserts multiple saves without duplicates', async () => {
    const first = candidate('first');
    const revised = { ...first, title: 'Updated groceries' };
    const second = candidate('second');
    const sam = candidate('sam', {
      bankLink: { txId: 'tx-sam', linkedAccountId: 'account-sam', ownerUserId: 'sam' },
    });
    getCandidates.mockResolvedValueOnce({ success: true, data: [first] });
    const { result } = renderHook(() => useBankSplitCandidates());
    await act(() => result.current.loadCandidatesFor('account-alex', ledger));
    const samRead = deferredRead();
    let samLoading!: Promise<void>;
    act(() => { samLoading = result.current.loadCandidatesFor('account-sam', ledger); });
    act(() => {
      result.current.addConfirmedCandidate('account-alex', first);
      result.current.addConfirmedCandidate('account-alex', second);
      result.current.addConfirmedCandidate('account-alex', revised);
    });
    // Alex's saves do not supersede Sam's pending request.
    await act(async () => {
      samRead.resolve({ success: true, data: [sam] });
      await samLoading;
    });
    expect(result.current.candidatesByLink['account-alex']).toEqual([revised, second]);
    expect(result.current.candidatesByLink['account-sam']).toEqual([sam]);
    // Releasing one saved expense must leave the other protected.
    getCandidates.mockResolvedValueOnce({ success: true, data: [revised] });
    await act(() => result.current.loadCandidatesFor('account-alex', ledger));
    getCandidates.mockResolvedValueOnce({ success: true, data: [] });
    await act(() => result.current.loadCandidatesFor('account-alex', ledger));
    expect(result.current.candidatesByLink['account-alex']).toEqual([second]);
    expect(result.current.candidatesByLink['account-sam']).toEqual([sam]);
  });

  it('uses display months and loads automatically only for changed ledger array identity', async () => {
    getCandidates.mockResolvedValue({ success: true, data: [] });
    const transactions = [
      transaction({ transactionDate: '2026-09-30T20:00:00Z' }),
      transaction({ id: 'tx-2', bookingDate: '2026-10-05' }),
      transaction({ id: 'tx-3', bookingDate: '2026-10-06' }),
    ];
    const { result, rerender } = renderHook(() => useBankSplitCandidates());
    const callbacks = {
      load: result.current.loadCandidatesFor,
      ensure: result.current.ensureCandidatesFor,
      add: result.current.addConfirmedCandidate,
    };
    await act(async () => result.current.ensureCandidatesFor('account-alex', transactions));
    expect(getCandidates).toHaveBeenLastCalledWith(['2026-09', '2026-10']);
    rerender();
    act(() => result.current.ensureCandidatesFor('account-alex', transactions));
    expect(getCandidates).toHaveBeenCalledTimes(1);
    const combined = result.current.candidatesByLink;
    rerender();
    expect(result.current.candidatesByLink).toBe(combined);
    expect(result.current.loadCandidatesFor).toBe(callbacks.load);
    expect(result.current.ensureCandidatesFor).toBe(callbacks.ensure);
    expect(result.current.addConfirmedCandidate).toBe(callbacks.add);
    await act(async () => result.current.ensureCandidatesFor('account-alex', [...transactions]));
    expect(getCandidates).toHaveBeenCalledTimes(2);
    await act(() => result.current.loadCandidatesFor('account-alex', transactions));
    act(() => result.current.ensureCandidatesFor('account-alex', transactions));
    expect(getCandidates).toHaveBeenCalledTimes(3);
  });

  it('uses an empty ledger as an empty read without a server call and supersedes a pending response', async () => {
    const pending = deferredRead();
    const { result } = renderHook(() => useBankSplitCandidates());
    let loading!: Promise<void>;
    act(() => { loading = result.current.loadCandidatesFor('account-alex', ledger); });
    await act(() => result.current.loadCandidatesFor('account-alex', []));
    expect(result.current.candidatesByLink['account-alex']).toEqual([]);
    expect(getCandidates).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ success: true, data: [candidate()] });
      await loading;
    });
    expect(result.current.candidatesByLink['account-alex']).toEqual([]);
  });
});
