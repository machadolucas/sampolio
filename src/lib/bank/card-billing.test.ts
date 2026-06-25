import { describe, it, expect } from 'vitest';
import { computeCardBilling, type CardTxn } from './card-billing';

const now = new Date('2026-06-24T12:00:00');

describe('computeCardBilling', () => {
  it('returns only the outstanding when no cycle is configured', () => {
    const res = computeCardBilling({ transactions: [], outstanding: 250, now });
    expect(res.bills).toEqual([]);
    expect(res.outstanding).toBe(250);
  });

  it('bills the most recent closed statement on the next due date (next month)', () => {
    const transactions: CardTxn[] = [
      { bookingDate: '2026-05-25', amount: -50 }, // in (05-20, 06-20]
      { bookingDate: '2026-06-01', amount: -100 }, // in cycle
      { bookingDate: '2026-04-10', amount: -999 }, // older cycle, excluded
    ];
    const res = computeCardBilling({ statementDay: 20, paymentDueDay: 10, transactions, now });
    expect(res.bills).toHaveLength(1);
    expect(res.bills[0]).toMatchObject({ billYearMonth: '2026-07', amount: 150, isEstimate: false });
    expect(res.bills[0].statementCloseDate).toBe('2026-06-20');
    expect(res.bills[0].dueDate).toBe('2026-07-10');
    expect(res.currentBillYearMonth).toBe('2026-07');
  });

  it('computes the best day to shop as the day after the statement closes', () => {
    const res = computeCardBilling({ statementDay: 20, paymentDueDay: 10, transactions: [], now });
    expect(res.bestShopDay).toBe(21);
  });

  it('handles a same-month due date (due day after close day)', () => {
    const transactions: CardTxn[] = [{ bookingDate: '2026-06-02', amount: -80 }];
    const res = computeCardBilling({ statementDay: 5, paymentDueDay: 25, transactions, now });
    // close = 2026-06-05, due = 2026-06-25 (same month)
    expect(res.bills[0]).toMatchObject({ billYearMonth: '2026-06', amount: 80 });
    expect(res.bills[0].dueDate).toBe('2026-06-25');
  });

  it('adds an estimate for the open cycle when enabled', () => {
    const transactions: CardTxn[] = [
      { bookingDate: '2026-06-01', amount: -150 }, // closed cycle (05-20, 06-20]
      { bookingDate: '2026-06-22', amount: -30 }, // open cycle (06-20, now]
    ];
    const res = computeCardBilling({
      statementDay: 20,
      paymentDueDay: 10,
      transactions,
      includeOpenCycleEstimate: true,
      now,
    });
    expect(res.bills).toHaveLength(2);
    const estimate = res.bills.find((b) => b.isEstimate);
    expect(estimate).toMatchObject({ billYearMonth: '2026-08', amount: 30 });
    expect(res.outstanding).toBe(180); // 150 closed + 30 open
  });

  it('prefers an explicit outstanding from the bank over derivation', () => {
    const res = computeCardBilling({
      statementDay: 20,
      paymentDueDay: 10,
      transactions: [{ bookingDate: '2026-06-01', amount: -150 }],
      outstanding: 1234.56,
      now,
    });
    expect(res.outstanding).toBe(1234.56);
  });

  it('crosses the year boundary for a December statement', () => {
    const decNow = new Date('2026-12-22T12:00:00');
    const res = computeCardBilling({
      statementDay: 20,
      paymentDueDay: 10,
      transactions: [{ bookingDate: '2026-12-05', amount: -200 }],
      now: decNow,
    });
    // close 2026-12-20, due 2027-01-10
    expect(res.bills[0]).toMatchObject({ billYearMonth: '2027-01', amount: 200 });
    expect(res.bills[0].dueDate).toBe('2027-01-10');
  });
});
