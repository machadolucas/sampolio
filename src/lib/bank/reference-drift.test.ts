import { describe, expect, it } from 'vitest';
import type { BankTransaction } from '@/types';
import { hasTransactionReferenceDrift } from './reference-drift';

const window = { fromDate: '2026-10-01', toDate: '2026-10-31' };
function tx(ref: string, changes: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: `id-${ref}`, linkedAccountId: 'account-a', dedupKey: ref, entryReference: ref,
    bookingDate: '2026-10-14', transactionDate: '2026-10-13', valueDate: '2026-10-14',
    amount: -40.16, currency: 'EUR', status: 'booked', counterpartyName: 'Example shop',
    counterpartyAccount: 'example', remittanceInfo: 'Purchase', referenceNumber: '123',
    referenceNumberSchema: 'SCOR', bankTransactionCode: 'card', merchantCategoryCode: '1234',
    balanceAfter: 100, note: 'note', firstSeenAt: '2026-10-14', lastSeenAt: '2026-10-14',
    ...changes,
  };
}
const drift = (old: BankTransaction[], next: BankTransaction[]) =>
  hasTransactionReferenceDrift(old, next, window);

describe('booked transaction reference drift', () => {
  it('flags a replacement while leaving input rows untouched', () => {
    const old = tx('old', { bookingDate: '2026-10-14T12:00:00Z' });
    const next = tx('new', { bookingDate: '2026-10-14T12:00:00Z' });
    const before = structuredClone([old, next]);
    expect(drift([old], [next])).toBe(true);
    expect([old, next]).toEqual(before);
  });

  it('detects a match amid unrelated rows and ambiguous identical rows', () => {
    expect(drift([tx('old'), tx('old-2'), tx('other', { amount: -1 })],
      [tx('new'), tx('new-2'), tx('other', { amount: -1 })])).toBe(true);
  });

  it('does not flag a new identical purchase when the old reference is still present', () => {
    expect(drift([tx('old')], [tx('old'), tx('new')])).toBe(false);
  });

  it('ignores same-reference updates and pending-to-booked promotion', () => {
    expect(drift([tx('same')], [tx('same', { amount: -50 })])).toBe(false);
    expect(drift([tx('old', { status: 'pending' })], [tx('new')])).toBe(false);
  });

  it('requires the same account, valid in-window date, cents and currency', () => {
    for (const changes of [
      { linkedAccountId: 'account-b' }, { bookingDate: '2026-10-15' },
      { bookingDate: '2026-10-14T12:00:00Z' },
      { bookingDate: '2026-11-01' }, { bookingDate: '2026-02-30' },
      { bookingDate: 'not-a-date' }, { amount: -40.17 }, { amount: Number.NaN },
      { amount: Number.POSITIVE_INFINITY }, { currency: 'USD' as const },
    ]) expect(drift([tx('old')], [tx('new', changes)])).toBe(false);
    expect(drift([tx('old', { bookingDate: '2026-09-30' })], [tx('new', { bookingDate: '2026-09-30' })])).toBe(false);
  });

  it.each([
    ['transactionDate', '2026-10-12'], ['valueDate', '2026-10-13'],
    ['counterpartyName', 'Different'], ['counterpartyAccount', 'different'],
    ['remittanceInfo', 'Different'], ['referenceNumber', '456'],
    ['referenceNumberSchema', 'different'], ['bankTransactionCode', 'different'],
    ['merchantCategoryCode', '9999'], ['balanceAfter', 99], ['note', 'different'],
  ] as const)('requires matching %s', (field, value) => {
    expect(drift([tx('old')], [tx('new', { [field]: value })])).toBe(false);
  });

  it('requires identifying text and real references', () => {
    const sparse = { counterpartyName: ' ', counterpartyAccount: undefined, remittanceInfo: '', referenceNumber: undefined };
    expect(drift([tx('old', sparse)], [tx('new', sparse)])).toBe(false);
    expect(drift([tx('old', { entryReference: ' ' })], [tx('new')])).toBe(false);
    expect(drift([tx('old')], [tx('new', { entryReference: undefined })])).toBe(false);
  });

  it('does not consider a reference new or removed when it occurs elsewhere in its account', () => {
    expect(drift([tx('old'), tx('new', { amount: -1 })], [tx('new')])).toBe(false);
    expect(drift([tx('old')], [tx('new'), tx('old', { amount: -1 })])).toBe(false);
  });
});
