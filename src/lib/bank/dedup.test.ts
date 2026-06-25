import { describe, it, expect } from 'vitest';
import { mergeTransactions, syntheticDedupKey } from './dedup';
import type { BankTransaction } from '@/types';

function tx(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: overrides.id ?? 'id-' + (overrides.dedupKey ?? 'x'),
    linkedAccountId: 'acct-1',
    dedupKey: 'ref-1',
    entryReference: 'ref-1',
    bookingDate: '2026-06-01',
    amount: -10,
    currency: 'EUR',
    status: 'booked',
    firstSeenAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('syntheticDedupKey', () => {
  it('is deterministic and ignores booking date', () => {
    const a = syntheticDedupKey({ amount: -12.5, currency: 'EUR', counterpartyName: 'Shop', remittanceInfo: 'x', valueDate: '2026-06-02' });
    const b = syntheticDedupKey({ amount: -12.5, currency: 'EUR', counterpartyName: 'Shop', remittanceInfo: 'x', valueDate: '2026-06-02' });
    expect(a).toBe(b);
    expect(a.startsWith('syn:')).toBe(true);
  });

  it('differs when amount differs', () => {
    const a = syntheticDedupKey({ amount: -12.5, currency: 'EUR', valueDate: '2026-06-02' });
    const b = syntheticDedupKey({ amount: -13.5, currency: 'EUR', valueDate: '2026-06-02' });
    expect(a).not.toBe(b);
  });
});

describe('mergeTransactions', () => {
  const now = '2026-06-10T12:00:00.000Z';

  it('adds new transactions', () => {
    const res = mergeTransactions([], [tx({ dedupKey: 'a', entryReference: 'a' }), tx({ dedupKey: 'b', entryReference: 'b' })], now);
    expect(res.added).toBe(2);
    expect(res.updated).toBe(0);
    expect(res.merged).toHaveLength(2);
  });

  it('is idempotent on overlapping re-fetch (no dupes)', () => {
    const existing = [tx({ dedupKey: 'a', entryReference: 'a', firstSeenAt: '2026-06-01T00:00:00.000Z' })];
    const res = mergeTransactions(existing, [tx({ dedupKey: 'a', entryReference: 'a' })], now);
    expect(res.added).toBe(0);
    expect(res.updated).toBe(1);
    expect(res.merged).toHaveLength(1);
    // firstSeenAt preserved, lastSeenAt refreshed
    expect(res.merged[0].firstSeenAt).toBe('2026-06-01T00:00:00.000Z');
    expect(res.merged[0].lastSeenAt).toBe(now);
  });

  it('promotes a pending row to its booked counterpart', () => {
    const pendingKey = syntheticDedupKey({ amount: -25, currency: 'EUR', counterpartyName: 'Cafe', remittanceInfo: 'coffee', valueDate: '2026-06-05' });
    const pending = tx({
      id: 'pending-1',
      dedupKey: pendingKey,
      entryReference: undefined,
      status: 'pending',
      amount: -25,
      counterpartyName: 'Cafe',
      remittanceInfo: 'coffee',
      valueDate: '2026-06-05',
      bookingDate: '2026-06-05',
      firstSeenAt: '2026-06-05T00:00:00.000Z',
    });
    const booked = tx({
      id: 'booked-1',
      dedupKey: 'real-ref-99',
      entryReference: 'real-ref-99',
      status: 'booked',
      amount: -25,
      counterpartyName: 'Cafe',
      remittanceInfo: 'coffee',
      valueDate: '2026-06-05',
      bookingDate: '2026-06-06',
    });

    const res = mergeTransactions([pending], [booked], now);
    expect(res.merged).toHaveLength(1);
    expect(res.updated).toBe(1);
    expect(res.added).toBe(0);
    const only = res.merged[0];
    expect(only.dedupKey).toBe('real-ref-99');
    expect(only.status).toBe('booked');
    // identity continuity: firstSeenAt carried from the pending row
    expect(only.firstSeenAt).toBe('2026-06-05T00:00:00.000Z');
  });

  it('keeps distinct booked transactions separate', () => {
    const res = mergeTransactions(
      [tx({ dedupKey: 'a', entryReference: 'a' })],
      [tx({ dedupKey: 'b', entryReference: 'b', bookingDate: '2026-06-09' })],
      now
    );
    expect(res.merged).toHaveLength(2);
    // sorted newest-first
    expect(res.merged[0].bookingDate >= res.merged[1].bookingDate).toBe(true);
  });
});
