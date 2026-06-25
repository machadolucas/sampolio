import { describe, it, expect } from 'vitest';
import {
  mapAspsps,
  mapSessionAccounts,
  mapBalances,
  pickAnchorBalance,
  mapTransactions,
  inferAccountRole,
  toCurrency,
} from './mappers';

let seq = 0;
const idFactory = () => `tx-${++seq}`;

describe('toCurrency', () => {
  it('accepts known currencies and falls back to EUR', () => {
    expect(toCurrency('SEK')).toBe('SEK');
    expect(toCurrency('XXX')).toBe('EUR');
    expect(toCurrency(undefined)).toBe('EUR');
  });
});

describe('inferAccountRole', () => {
  it('maps cash, card and savings', () => {
    expect(inferAccountRole({ cash_account_type: 'CACC' })).toBe('cash');
    expect(inferAccountRole({ cash_account_type: 'CARD' })).toBe('credit-card');
    expect(inferAccountRole({ cash_account_type: 'SVGS' })).toBe('savings');
    expect(inferAccountRole({ product: 'Gold Credit Card' })).toBe('credit-card');
    expect(inferAccountRole({})).toBe('other');
  });
});

describe('mapAspsps', () => {
  it('maps and uppercases country', () => {
    expect(mapAspsps({ aspsps: [{ name: 'Nordea', country: 'fi' }, { country: 'FI' }] })).toEqual([
      { name: 'Nordea', country: 'FI' },
    ]);
  });
});

describe('mapSessionAccounts', () => {
  it('extracts uid, iban, currency and role', () => {
    const out = mapSessionAccounts({
      accounts: [
        { uid: 'u1', account_id: { iban: 'FI2112345600000785' }, name: 'Main', currency: 'EUR', cash_account_type: 'CACC' },
        { uid: 'u2', name: 'Visa', currency: 'EUR', cash_account_type: 'CARD' },
        { name: 'no-uid' },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ accountUid: 'u1', iban: 'FI2112345600000785', accountRole: 'cash' });
    expect(out[1]).toMatchObject({ accountUid: 'u2', accountRole: 'credit-card' });
  });
});

describe('mapBalances + pickAnchorBalance', () => {
  it('prefers closing-booked', () => {
    const balances = mapBalances({
      balances: [
        { balance_type: 'ITAV', balance_amount: { amount: '900.00', currency: 'EUR' } },
        { balance_type: 'CLBD', balance_amount: { amount: '1000.50', currency: 'EUR' } },
      ],
    });
    expect(balances).toHaveLength(2);
    const anchor = pickAnchorBalance(balances);
    expect(anchor).toMatchObject({ type: 'CLBD', amount: 1000.5 });
  });

  it('falls back to first balance when no priority type present', () => {
    const balances = mapBalances({ balances: [{ balance_type: 'INFO', balance_amount: { amount: 5, currency: 'EUR' } }] });
    expect(pickAnchorBalance(balances)?.amount).toBe(5);
  });
});

describe('mapTransactions', () => {
  const now = '2026-06-10T12:00:00.000Z';

  it('signs amounts by credit/debit indicator', () => {
    const { transactions } = mapTransactions(
      {
        transactions: [
          { entry_reference: 'r1', booking_date: '2026-06-01', transaction_amount: { amount: '12.00', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', creditor: { name: 'Shop' } },
          { entry_reference: 'r2', booking_date: '2026-06-02', transaction_amount: { amount: '50.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', debtor: { name: 'Employer' } },
        ],
      },
      'acct-1',
      now,
      idFactory
    );
    expect(transactions[0]).toMatchObject({ amount: -12, status: 'booked', dedupKey: 'r1', counterpartyName: 'Shop' });
    expect(transactions[1]).toMatchObject({ amount: 50, status: 'booked', dedupKey: 'r2', counterpartyName: 'Employer' });
  });

  it('uses a synthetic key for pending / reference-less rows', () => {
    const { transactions } = mapTransactions(
      {
        transactions: [
          { booking_date: '2026-06-03', value_date: '2026-06-03', transaction_amount: { amount: '7.50', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'PDNG', creditor: { name: 'Cafe' }, remittance_information: ['coffee'] },
        ],
      },
      'acct-1',
      now,
      idFactory
    );
    expect(transactions[0].status).toBe('pending');
    expect(transactions[0].dedupKey.startsWith('syn:')).toBe(true);
    expect(transactions[0].remittanceInfo).toBe('coffee');
  });

  it('passes through the continuation key', () => {
    const res = mapTransactions({ transactions: [], continuation_key: 'page-2' }, 'acct-1', now, idFactory);
    expect(res.continuationKey).toBe('page-2');
  });
});
