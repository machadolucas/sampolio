/**
 * Enable Banking — credit-card billing engine (pure, no I/O, fully testable).
 *
 * AIS rarely exposes statement-close / due dates, so they're configured per card.
 * Given those days + the card's transactions (and/or a known statement balance),
 * this derives:
 *   - the firm bill for the most recent CLOSED statement (due on the next
 *     payment-due date) — injected into the paying account's cashflow,
 *   - an optional ESTIMATE for the current open cycle,
 *   - the current outstanding + the month it's due (for the net-worth liability),
 *   - the "best day to shop" = the day after the statement closes (max float).
 */

import type { YearMonth } from '@/types';

export interface CardTxn {
  bookingDate: string; // 'YYYY-MM-DD'
  amount: number; // signed: spend negative, payment/refund positive
}

export interface CardBill {
  billYearMonth: YearMonth; // month the bill is due (drives the cashflow line)
  amount: number; // positive amount owed
  isEstimate: boolean; // true for the not-yet-closed current cycle
  statementCloseDate: string; // 'YYYY-MM-DD'
  dueDate: string; // 'YYYY-MM-DD'
}

export interface CardBillingResult {
  bills: CardBill[];
  outstanding: number; // current total owed (positive)
  currentBillYearMonth?: YearMonth; // when the current outstanding is due
  bestShopDay?: number; // day-of-month that maximizes interest-free float
  nextStatementCloseDate?: string;
}

export interface CardBillingInput {
  statementDay?: number;
  paymentDueDay?: number;
  outstanding?: number; // current balance from sync (preferred source)
  lastStatementBalance?: number; // explicit statement balance, if known
  transactions: CardTxn[];
  includeOpenCycleEstimate?: boolean;
  now?: Date;
}

function clampDay(year: number, month1to12: number, day: number): number {
  const daysInMonth = new Date(year, month1to12, 0).getDate();
  return Math.min(Math.max(day, 1), daysInMonth);
}

function dateAt(year: number, month1to12: number, day: number): Date {
  return new Date(year, month1to12 - 1, clampDay(year, month1to12, day));
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yearMonthOf(d: Date): YearMonth {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The statement close on-or-before `asOf`, and the prior close (cycle start). */
function recentCloses(asOf: Date, statementDay: number): { close: Date; prevClose: Date; nextClose: Date } {
  const y = asOf.getFullYear();
  const m = asOf.getMonth() + 1;
  const thisMonthClose = dateAt(y, m, statementDay);
  const close = asOf >= thisMonthClose ? thisMonthClose : dateAt(y, m - 1, statementDay);
  const prevClose = dateAt(close.getFullYear(), close.getMonth(), statementDay); // month before `close`
  const nextClose = dateAt(close.getFullYear(), close.getMonth() + 2, statementDay); // month after `close`
  return { close, prevClose, nextClose };
}

/** First date strictly after `after` whose day-of-month is `day`. */
function nextDueAfter(after: Date, day: number): Date {
  let candidate = dateAt(after.getFullYear(), after.getMonth() + 1, day);
  if (candidate <= after) candidate = dateAt(after.getFullYear(), after.getMonth() + 2, day);
  return candidate;
}

/** Net spend in (start, end]: spend is negative, so negate the sum; floor at 0. */
function cycleSpend(transactions: CardTxn[], start: Date, end: Date): number {
  let sum = 0;
  for (const t of transactions) {
    const d = new Date(`${t.bookingDate}T00:00:00`);
    if (d > start && d <= end) sum += t.amount;
  }
  return Math.max(0, -sum);
}

export function computeCardBilling(input: CardBillingInput): CardBillingResult {
  const now = input.now ?? new Date();
  const { statementDay, paymentDueDay } = input;

  // Without a cycle configured we can still report the outstanding, but no bills.
  if (!statementDay || !paymentDueDay) {
    return {
      bills: [],
      outstanding: Math.max(0, input.outstanding ?? input.lastStatementBalance ?? 0),
    };
  }

  const { close, prevClose, nextClose } = recentCloses(now, statementDay);

  // Most recent CLOSED statement → firm bill.
  const closedBalance =
    input.lastStatementBalance != null
      ? Math.max(0, input.lastStatementBalance)
      : cycleSpend(input.transactions, prevClose, close);
  const closedDue = nextDueAfter(close, paymentDueDay);

  const bills: CardBill[] = [];
  if (closedBalance > 0.005) {
    bills.push({
      billYearMonth: yearMonthOf(closedDue),
      amount: closedBalance,
      isEstimate: false,
      statementCloseDate: ymd(close),
      dueDate: ymd(closedDue),
    });
  }

  // Optional estimate for the current open cycle (close, now].
  if (input.includeOpenCycleEstimate) {
    const openSpend = cycleSpend(input.transactions, close, now);
    if (openSpend > 0.005) {
      const openDue = nextDueAfter(nextClose, paymentDueDay);
      bills.push({
        billYearMonth: yearMonthOf(openDue),
        amount: openSpend,
        isEstimate: true,
        statementCloseDate: ymd(nextClose),
        dueDate: ymd(openDue),
      });
    }
  }

  const outstanding = Math.max(
    0,
    input.outstanding ?? closedBalance + cycleSpend(input.transactions, close, now)
  );

  return {
    bills,
    outstanding,
    currentBillYearMonth: yearMonthOf(closedDue),
    bestShopDay: clampDay(now.getFullYear(), now.getMonth() + 1, statementDay + 1),
    nextStatementCloseDate: ymd(nextClose),
  };
}
