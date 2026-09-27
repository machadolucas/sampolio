/**
 * Live (bank-sync) anchor helpers — pure, clock-free.
 *
 * A manual check-in snapshot for month M (and an account's genesis) is the
 * balance at the START of M. A `source: 'bank-sync'` snapshot is different:
 * `autoAnchorAccount` (src/lib/bank/sync.ts) stores the LIVE booked balance on
 * the sync day, so it already contains every transaction of M booked on or
 * before that day (its "as-of" date, the local date of `createdAt`).
 *
 * Consumers that need the start-of-month value subtract the anchor month's
 * booked net through the as-of date (`startOfMonthFromLive`); the cashflow
 * forecast instead actualizes the anchor month with those same booked
 * transactions (see `getCurrentMonthActualsForAccount`).
 */

import { format } from 'date-fns';
import type {
  BalanceSnapshot,
  BankTransaction,
  FinancialAccount,
  PlannedItem,
  RecurringItem,
  TaxedIncome,
  YearMonth,
} from '@/types';
import { calculateProjection, compareYearMonths, resolveAnchor } from './projection';

interface BookedLike {
  amount: number;
  bookingDate: string;
  status?: string;
}

/**
 * The as-of date ('yyyy-MM-dd', server-local like the bank's booking dates) of
 * the resolved anchor when it is a live bank-sync balance, else null. Mirrors
 * `resolveAnchor`: a snapshot before the genesis month is ignored there, so it
 * is ignored here too.
 */
export function liveAnchorAsOf(
  genesisMonth: YearMonth,
  snapshot: Pick<BalanceSnapshot, 'yearMonth' | 'source' | 'createdAt'> | null | undefined
): string | null {
  if (!snapshot || snapshot.source !== 'bank-sync') return null;
  if (compareYearMonths(snapshot.yearMonth, genesisMonth) < 0) return null;
  const at = new Date(snapshot.createdAt);
  if (Number.isNaN(at.getTime())) return null;
  return format(at, 'yyyy-MM-dd');
}

/**
 * Booked transactions dated in `month`, and — when `asOf` is given — on or
 * before that date (rows booked after a live balance was read are not in it).
 * Rows without a status are treated as booked.
 */
export function bookedInMonthThrough<T extends BookedLike>(
  transactions: T[],
  month: YearMonth,
  asOf: string | null
): T[] {
  return transactions.filter((t) => {
    if (t.status !== undefined && t.status !== 'booked') return false;
    if (t.bookingDate.slice(0, 7) !== month) return false;
    return asOf === null || t.bookingDate.slice(0, 10) <= asOf;
  });
}

/** Signed sum of `amount` (credits +, debits −). */
export function netOf(transactions: { amount: number }[]): number {
  return transactions.reduce((sum, t) => sum + t.amount, 0);
}

/**
 * Start-of-month balance behind a live balance: `liveBalance` minus the net of
 * `month`'s booked transactions through `asOf`.
 */
export function startOfMonthFromLive(
  liveBalance: number,
  transactions: BookedLike[],
  month: YearMonth,
  asOf: string | null
): number {
  return liveBalance - netOf(bookedInMonthThrough(transactions, month, asOf));
}

/**
 * The `expectedBalance` a bank-sync snapshot records for `month`: the planned
 * START-of-month balance plus the month's booked net through `asOf` (the sync
 * day). Comparing that with the live balance makes the snapshot's variance the
 * start-of-month drift (actual opening balance − planned opening balance),
 * independent of when in the month the sync ran — a live mid-month balance is
 * never compared with an end-of-month forecast.
 *
 * The planned opening balance comes from the prior anchor:
 *  - same month: the prior anchor itself (a prior live bank-sync balance is
 *    converted to its opening balance first) — no forecast involved;
 *  - earlier month: `calculateProjection` (card-paid items excluded, capped at
 *    `month`), actualizing a live prior anchor's month with its booked rows
 *    through its as-of date exactly like the cashflow forecast does.
 * Mortgage/budget/card-bill transfers are not injected here (background tick,
 * no cached reads), so a month boundary between syncs can still carry their
 * difference. Returns null when no planned row exists for `month` (the prior
 * anchor is later, or the account's custom end date is earlier).
 */
export function expectedLiveBalance(params: {
  account: FinancialAccount;
  recurringItems: RecurringItem[];
  plannedItems: PlannedItem[];
  taxedIncomes: TaxedIncome[];
  priorSnapshot: BalanceSnapshot | null;
  transactions: BankTransaction[];
  month: YearMonth;
  asOf: string;
}): number | null {
  const { account, priorSnapshot, transactions, month, asOf } = params;
  const anchor = resolveAnchor(account.startingDate, account.startingBalance, priorSnapshot);
  const priorAsOf = liveAnchorAsOf(account.startingDate, priorSnapshot);
  const cmp = compareYearMonths(anchor.startMonth, month);
  if (cmp > 0) return null;

  let openingBalance: number;
  if (cmp === 0) {
    openingBalance = priorAsOf
      ? startOfMonthFromLive(anchor.startBalance, transactions, month, priorAsOf)
      : anchor.startBalance;
  } else {
    const actuals = priorAsOf
      ? {
          transactions: bookedInMonthThrough(transactions, anchor.startMonth, priorAsOf).map((t) => ({
            id: t.id,
            amount: t.amount,
            bookingDate: t.bookingDate,
            counterpartyName: t.counterpartyName,
            remittanceInfo: t.remittanceInfo,
            bankTransactionCode: t.bankTransactionCode,
          })),
        }
      : null;
    const rows = calculateProjection(
      account,
      params.recurringItems.filter((i) => !i.paidByCardLinkId),
      params.plannedItems.filter((i) => !i.paidByCardLinkId),
      params.taxedIncomes,
      { endDate: month },
      priorSnapshot,
      [],
      [],
      [],
      actuals
    );
    const row = rows.find((r) => r.yearMonth === month);
    if (!row) return null;
    openingBalance = row.startingBalance;
  }
  return openingBalance + netOf(bookedInMonthThrough(transactions, month, asOf));
}
