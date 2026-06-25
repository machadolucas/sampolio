/**
 * Enable Banking — pure transaction dedup / merge (no I/O, fully testable).
 *
 * Dedup key: a booked transaction's stable `entry_reference`; for pending or
 * unstable rows (null/absent reference) a deterministic synthetic key derived
 * from the row's content. The merge is idempotent — re-fetching an overlapping
 * window never duplicates rows — and promotes a pending row to its booked
 * counterpart when the booked version (carrying a real reference) arrives.
 */

import type { BankTransaction } from '@/types';

/** Fields that identify a transaction's content for synthetic keying. */
type TxContent = Pick<
  BankTransaction,
  'amount' | 'currency' | 'counterpartyName' | 'remittanceInfo' | 'valueDate'
>;

/**
 * Deterministic synthetic dedup key for a pending / reference-less transaction.
 * Excludes booking date (pending rows often lack it) so a later booked row with
 * the same content can be recognized as the same underlying transaction.
 */
export function syntheticDedupKey(t: TxContent): string {
  const basis = [
    t.amount.toFixed(2),
    t.currency,
    (t.counterpartyName ?? '').trim().toLowerCase(),
    (t.remittanceInfo ?? '').trim().toLowerCase(),
    t.valueDate ?? '',
  ].join('|');

  // djb2 (xor variant) — small, stable, dependency-free.
  let h = 5381;
  for (let i = 0; i < basis.length; i++) {
    h = ((h << 5) + h) ^ basis.charCodeAt(i);
    h |= 0;
  }
  return `syn:${(h >>> 0).toString(16)}`;
}

export interface MergeResult {
  merged: BankTransaction[];
  added: number;
  updated: number;
}

/**
 * Merge `incoming` rows into `existing`, deduping by `dedupKey` and promoting
 * pending → booked. `nowIso` stamps `lastSeenAt` (and `firstSeenAt` for new
 * rows). The result is sorted newest-first by booking date.
 */
export function mergeTransactions(
  existing: BankTransaction[],
  incoming: BankTransaction[],
  nowIso: string
): MergeResult {
  const byKey = new Map<string, BankTransaction>();
  for (const t of existing) byKey.set(t.dedupKey, t);

  let added = 0;
  let updated = 0;

  for (const inc of incoming) {
    const prior = byKey.get(inc.dedupKey);
    if (prior) {
      // Same identity → refresh fields, preserve firstSeenAt.
      byKey.set(inc.dedupKey, {
        ...prior,
        ...inc,
        firstSeenAt: prior.firstSeenAt,
        lastSeenAt: nowIso,
      });
      updated++;
      continue;
    }

    // pending → booked promotion: a booked row carrying a real entry_reference
    // supersedes an earlier synthetic-keyed pending row with the same content.
    if (inc.status === 'booked' && inc.entryReference) {
      const sig = syntheticDedupKey(inc);
      const priorPending = byKey.get(sig);
      if (priorPending && priorPending.status === 'pending') {
        byKey.delete(sig);
        byKey.set(inc.dedupKey, {
          ...inc,
          firstSeenAt: priorPending.firstSeenAt,
          lastSeenAt: nowIso,
        });
        updated++;
        continue;
      }
    }

    byKey.set(inc.dedupKey, {
      ...inc,
      firstSeenAt: inc.firstSeenAt || nowIso,
      lastSeenAt: nowIso,
    });
    added++;
  }

  const merged = [...byKey.values()].sort((a, b) => {
    const byDate = b.bookingDate.localeCompare(a.bookingDate);
    return byDate !== 0 ? byDate : a.dedupKey.localeCompare(b.dedupKey);
  });
  return { merged, added, updated };
}
