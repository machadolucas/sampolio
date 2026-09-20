import { describe, it, expect } from 'vitest';
import { findSplitDuplicateCandidates, matchTransactionsToSplits, type BankTxForMatch } from './bank-split-match';
import type { SplitLinkCandidate } from '@/types';

function tx(overrides: Partial<BankTxForMatch> & { id: string }): BankTxForMatch {
  return { amount: -10, currency: 'EUR', bookingDate: '2026-07-01', ...overrides };
}

function candidate(overrides: Partial<SplitLinkCandidate> & { expenseId: string }): SplitLinkCandidate {
  return {
    groupId: 'g1',
    groupName: 'Roomies',
    title: 'Groceries',
    date: '2026-07-01',
    amountCents: 1000,
    currency: 'EUR',
    ...overrides,
  };
}

describe('duplicate candidate detection', () => {
  it('returns all exact linked rows instead of hiding a duplicate', () => {
    const t = tx({ id: 'tx1', counterpartyName: 'Corner Cafe' });
    const a = candidate({ expenseId: 'e1', title: 'Corner Cafe', bankLink: { txId: 'tx1', linkedAccountId: 'l1', ownerUserId: 'u1' } });
    const b = candidate({ expenseId: 'e2', title: 'Corner Cafe', bankLink: { txId: 'tx1', linkedAccountId: 'l1', ownerUserId: 'u1' } });
    const out = findSplitDuplicateCandidates(t, [a, b], 'g1');
    expect(out.map((x) => x.expenseId).sort()).toEqual(['e1', 'e2']);
    const match = matchTransactionsToSplits([t], [a, b]).get('tx1');
    expect(match?.related?.map((x) => x.expenseId)).toEqual(['e2']);
  });

  it('warns for an exact link even after bank amount/date drift', () => {
    const t = tx({ id: 'tx1', amount: -99, bookingDate: '2026-12-31', counterpartyName: 'Changed name' });
    const c = candidate({ expenseId: 'e1', amountCents: 1, date: '2020-01-01', bankLink: { txId: 'tx1', linkedAccountId: 'l1', ownerUserId: 'u1' } });
    expect(findSplitDuplicateCandidates(t, [c], 'g1')).toMatchObject([{ expenseId: 'e1', kind: 'linked' }]);
  });

  it('recovers a pending link when booking gives the transaction a new id', () => {
    const t = tx({ id: 'booked-id', linkedAccountId: 'l1', counterpartyName: 'UNKNOWN*CORNER CAFE', transactionDate: '2026-07-01' });
    const c = candidate({
      expenseId: 'e1', title: 'Corner Cafe', date: '2026-07-01',
      bankLink: { txId: 'pending-id', linkedAccountId: 'l1', ownerUserId: 'u1', amount: -10, counterpartyName: 'Corner Cafe' },
    });
    expect(matchTransactionsToSplits([t], [c]).get('booked-id')).toMatchObject({ kind: 'recovered', expenseId: 'e1' });
  });

  it('shows the booked twin as recovered while retaining the pending exact link', () => {
    const pending = tx({ id: 'pending-id', linkedAccountId: 'l1', status: 'pending', counterpartyName: 'Corner Cafe' });
    const booked = tx({ id: 'booked-id', linkedAccountId: 'l1', status: 'booked', counterpartyName: 'UNKNOWN*CORNER CAFE' });
    const c = candidate({
      expenseId: 'e1', title: 'Corner Cafe', date: '2026-07-01',
      bankLink: { txId: 'pending-id', linkedAccountId: 'l1', ownerUserId: 'u1', amount: -10, counterpartyName: 'Corner Cafe' },
    });
    const out = matchTransactionsToSplits([pending, booked], [c]);
    expect(out.get('pending-id')).toMatchObject({ kind: 'linked', expenseId: 'e1' });
    expect(out.get('booked-id')).toMatchObject({ kind: 'recovered', expenseId: 'e1' });
  });

  it('does not recover a link belonging to another account', () => {
    const t = tx({ id: 'booked-id', linkedAccountId: 'other', counterpartyName: 'Shop' });
    const c = candidate({ expenseId: 'e1', bankLink: { txId: 'pending-id', linkedAccountId: 'l1', ownerUserId: 'u1', amount: -10, counterpartyName: 'Shop' } });
    expect(matchTransactionsToSplits([t], [c]).size).toBe(0);
  });

  it('allows a near amount only with strong merchant affinity', () => {
    const t = tx({ id: 'tx1', amount: -10.2, counterpartyName: 'Cafe Roma' });
    const close = candidate({ expenseId: 'e1', amountCents: 1000, title: 'Cafe Roma' });
    const unrelated = candidate({ expenseId: 'e2', amountCents: 1000, title: 'Other shop' });
    expect(findSplitDuplicateCandidates(t, [close], 'g1')).toHaveLength(1);
    expect(findSplitDuplicateCandidates(t, [unrelated], 'g1')).toHaveLength(0);
  });
});

describe('matchTransactionsToSplits', () => {
  it('matches an explicit link by txId even with different amount/date', () => {
    const t = tx({ id: 'tx1', amount: -999, bookingDate: '2020-01-01' });
    const c = candidate({ expenseId: 'e1', amountCents: 1, date: '2099-12-31', bankLink: { txId: 'tx1', linkedAccountId: 'l1', ownerUserId: 'u1' } });
    const out = matchTransactionsToSplits([t], [c]);
    expect(out.get('tx1')).toMatchObject({ kind: 'linked', expenseId: 'e1' });
  });

  it('prefers the explicit link over a heuristic candidate that would also match', () => {
    const t = tx({ id: 'tx1', amount: -10, bookingDate: '2026-07-01' });
    const linked = candidate({ expenseId: 'e-linked', bankLink: { txId: 'tx1', linkedAccountId: 'l1', ownerUserId: 'u1' } });
    const heuristic = candidate({ expenseId: 'e-heuristic', amountCents: 1000, date: '2026-07-01' });
    const out = matchTransactionsToSplits([t], [linked, heuristic]);
    expect(out.get('tx1')).toMatchObject({ kind: 'linked', expenseId: 'e-linked' });
  });

  it('matches heuristically on exact-cents amount, including float safety', () => {
    const t = tx({ id: 'tx1', amount: -27.03, bookingDate: '2026-07-01' });
    const c = candidate({ expenseId: 'e1', amountCents: 2703, date: '2026-07-01' });
    const out = matchTransactionsToSplits([t], [c]);
    expect(out.get('tx1')).toMatchObject({ kind: 'heuristic', expenseId: 'e1' });
  });

  it('matches within ±3 days but not at ±4 days, in both directions', () => {
    const base = { amount: -10, currency: 'EUR' };
    const c = candidate({ expenseId: 'e1', amountCents: 1000, date: '2026-07-10' });

    const within = matchTransactionsToSplits(
      [tx({ id: 'earlier3', ...base, bookingDate: '2026-07-07' }), tx({ id: 'later3', ...base, bookingDate: '2026-07-13' })],
      [c],
    );
    // Only one of the two can claim the single candidate; both are within tolerance so one must match.
    expect(within.size).toBe(1);

    const outside = matchTransactionsToSplits(
      [tx({ id: 'earlier4', ...base, bookingDate: '2026-07-06' })],
      [candidate({ expenseId: 'e2', amountCents: 1000, date: '2026-07-10' })],
    );
    expect(outside.size).toBe(0);

    const outsideLater = matchTransactionsToSplits(
      [tx({ id: 'later4', ...base, bookingDate: '2026-07-14' })],
      [candidate({ expenseId: 'e3', amountCents: 1000, date: '2026-07-10' })],
    );
    expect(outsideLater.size).toBe(0);
  });

  it('never matches across a currency mismatch', () => {
    const t = tx({ id: 'tx1', amount: -10, currency: 'USD', bookingDate: '2026-07-01' });
    const c = candidate({ expenseId: 'e1', amountCents: 1000, currency: 'EUR', date: '2026-07-01' });
    expect(matchTransactionsToSplits([t], [c]).size).toBe(0);
  });

  it('never heuristically matches a positive (credit) transaction', () => {
    const t = tx({ id: 'tx1', amount: 10, bookingDate: '2026-07-01' });
    const c = candidate({ expenseId: 'e1', amountCents: 1000, date: '2026-07-01' });
    expect(matchTransactionsToSplits([t], [c]).size).toBe(0);
  });

  it('excludes a candidate explicitly linked to a different tx from heuristic matching', () => {
    const t = tx({ id: 'tx1', amount: -10, bookingDate: '2026-07-01' });
    const c = candidate({
      expenseId: 'e1',
      amountCents: 1000,
      date: '2026-07-01',
      bankLink: { txId: 'some-other-tx', linkedAccountId: 'l1', ownerUserId: 'u1' },
    });
    expect(matchTransactionsToSplits([t], [c]).size).toBe(0);
  });

  it('resolves two candidates competing for one tx by picking the closer date', () => {
    const t = tx({ id: 'tx1', amount: -10, bookingDate: '2026-07-10' });
    const near = candidate({ expenseId: 'near', amountCents: 1000, date: '2026-07-09' });
    const far = candidate({ expenseId: 'far', amountCents: 1000, date: '2026-07-12' });
    const out = matchTransactionsToSplits([t], [near, far]);
    expect(out.get('tx1')).toMatchObject({ expenseId: 'near' });
  });

  it('flags only one of two competing transactions for a single candidate', () => {
    const t1 = tx({ id: 'tx1', amount: -10, bookingDate: '2026-07-09' });
    const t2 = tx({ id: 'tx2', amount: -10, bookingDate: '2026-07-12' });
    const c = candidate({ expenseId: 'e1', amountCents: 1000, date: '2026-07-10' });
    const out = matchTransactionsToSplits([t1, t2], [c]);
    expect(out.size).toBe(1);
    expect(out.get('tx1')).toMatchObject({ expenseId: 'e1' });
    expect(out.has('tx2')).toBe(false);
  });

  it('matches on transactionDate (purchase date) when bookingDate is 4 days later, outside tolerance', () => {
    // bookingDate alone would land outside the ±3 day window; transactionDate
    // (the real purchase date) makes it an exact match.
    const t = tx({ id: 'tx1', amount: -10, bookingDate: '2026-07-05', transactionDate: '2026-07-01' });
    const c = candidate({ expenseId: 'e1', amountCents: 1000, date: '2026-07-01' });
    const out = matchTransactionsToSplits([t], [c]);
    expect(out.get('tx1')).toMatchObject({ kind: 'heuristic', expenseId: 'e1' });
  });

  it('matches a bookingDate with a time component against a plain-date candidate', () => {
    const t = tx({ id: 'tx1', amount: -10, bookingDate: '2026-07-01T09:30:00' });
    const c = candidate({ expenseId: 'e1', amountCents: 1000, date: '2026-07-01' });
    const out = matchTransactionsToSplits([t], [c]);
    expect(out.get('tx1')).toMatchObject({ kind: 'heuristic', expenseId: 'e1' });
  });

  it('returns an empty map for empty inputs', () => {
    expect(matchTransactionsToSplits([], []).size).toBe(0);
    expect(matchTransactionsToSplits([tx({ id: 'tx1' })], []).size).toBe(0);
    expect(matchTransactionsToSplits([], [candidate({ expenseId: 'e1' })]).size).toBe(0);
  });
});
