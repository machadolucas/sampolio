import type { BankTransaction } from '@/types';

type FetchWindow = { fromDate: string; toDate: string };

/** Validate a date-only or ISO datetime value and return its calendar date. */
function bookingDay(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return null;
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

function reference(row: BankTransaction): string | null {
  return row.status === 'booked' && typeof row.entryReference === 'string' && row.entryReference.trim()
    ? row.entryReference
    : null;
}

function fingerprint(row: BankTransaction, window: FetchWindow): string | null {
  const day = bookingDay(row.bookingDate);
  if (!day || day < window.fromDate || day > window.toDate || !Number.isFinite(row.amount)) return null;
  if (![row.counterpartyName, row.remittanceInfo, row.referenceNumber, row.counterpartyAccount]
    .some((value) => typeof value === 'string' && value.trim().length > 0)) return null;
  const cents = Math.round(row.amount * 100);
  if (!Number.isSafeInteger(cents) || (row.balanceAfter != null && !Number.isFinite(row.balanceAfter))) return null;
  return JSON.stringify([
    row.linkedAccountId, row.bookingDate, cents, row.currency,
    row.transactionDate ?? null, row.valueDate ?? null, row.counterpartyName ?? null,
    row.counterpartyAccount ?? null, row.remittanceInfo ?? null, row.referenceNumber ?? null,
    row.referenceNumberSchema ?? null, row.bankTransactionCode ?? null,
    row.merchantCategoryCode ?? null, row.balanceAfter ?? null, row.note ?? null,
  ]);
}

/** Flag a possible booked-reference replacement without changing either ledger. */
export function hasTransactionReferenceDrift(
  existing: BankTransaction[],
  incoming: BankTransaction[],
  window: FetchWindow,
): boolean {
  const existingRefs = new Map<string, Set<string>>();
  const incomingRefs = new Map<string, Set<string>>();
  const collect = (rows: BankTransaction[], target: Map<string, Set<string>>) => {
    for (const row of rows) {
      const ref = reference(row);
      if (ref === null) continue;
      const refs = target.get(row.linkedAccountId) ?? new Set<string>();
      refs.add(ref);
      target.set(row.linkedAccountId, refs);
    }
  };
  collect(existing, existingRefs);
  collect(incoming, incomingRefs);

  const removed = new Set<string>();
  for (const row of existing) {
    const ref = reference(row);
    if (ref === null || incomingRefs.get(row.linkedAccountId)?.has(ref)) continue;
    const key = fingerprint(row, window);
    if (key !== null) removed.add(key);
  }
  for (const row of incoming) {
    const ref = reference(row);
    if (ref === null || existingRefs.get(row.linkedAccountId)?.has(ref)) continue;
    const key = fingerprint(row, window);
    if (key !== null && removed.has(key)) return true;
  }
  return false;
}
