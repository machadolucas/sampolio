/**
 * Live (bank-sync) anchor helpers — pure, clock-free.
 *
 * A manual check-in snapshot for month M (and an account's genesis) is the
 * balance at the START of M. A `source: 'bank-sync'` snapshot is different:
 * `autoAnchorAccount` (src/lib/bank/sync.ts) stores the LIVE balance the bank
 * reported, which already contains M's bookings through its as-of date.
 *
 * Snapshot semantics (see `BalanceSnapshot` in src/types/index.ts):
 *  - `actualBalance`: the amount the bank reported (`pickAnchorBalance`).
 *  - `balanceType`: its ISO 20022 type. Booked types (`ITBD`, `CLBD`, `OPBD`,
 *    `PRCD`) are reconstructible from booked rows; available/expected types
 *    (`ITAV`, `XPCD`, `CLAV`, `OPAV`, `FWAV`) also reflect pending rows (and,
 *    for an available balance, possibly a credit facility we cannot see).
 *  - `balanceAsOf`: the day the balance is as of (`resolveBalanceAsOf`): the
 *    bank's reference date when given (a CLBD may be yesterday's or the
 *    previous month's close), else the local sync date; an opening balance
 *    (`OPBD`/`OPAV`) is as of the end of the day before.
 *  - `monthStartBalance`: the booked-basis balance at the start of `yearMonth`,
 *    computed ONCE at write time from the ledger as it was right after that
 *    sync (`bankSnapshotProvenance`), so a later same-day booking or a
 *    back-dated posting can never be mistaken for part of this balance.
 *
 * Actualized anchor month (one rule for every anchor source). The anchor
 * month M is actualized against the linked bank ledger when it is the current
 * month (any anchor) or an earlier month anchored on a live bank-sync balance
 * (`shouldActualizeAnchorMonth`). Then:
 *  - month-start balance O (`anchorMonthOpeningBalance`): a bank-sync
 *    snapshot's stored `monthStartBalance`; a manual/genesis anchor's own
 *    balance (start of M by definition); a legacy bank-sync snapshot's
 *    reconstruction (`startOfMonthFromLive` through the local `createdAt` date);
 *  - the forecast starts M at O + EVERY booked row of M currently in the
 *    ledger, and exactly those rows are actualized as already paid
 *    (`anchorMonthActuals` → `calculateProjection`'s `currentMonthActuals`),
 *    so a booking after the balance's as-of date is neither lost nor doubled;
 *  - O is also the retrospective seed and the same-month variance baseline.
 * `balanceAsOf` is only used at write time, to derive `monthStartBalance`.
 *
 * Legacy compatibility: a bank-sync snapshot without these fields (written
 * before they existed) is read as a live BOOKED balance as of the server-local
 * date of `createdAt`, its opening reconstructed from the current ledger
 * (`startOfMonthFromLive`); from there the same actualized-month rule applies.
 */

import { format, parseISO, subDays } from 'date-fns';
import type {
  BalanceSnapshot,
  BankTransaction,
  FinancialAccount,
  PlannedItem,
  RecurringItem,
  TaxedIncome,
  YearMonth,
} from '@/types';
import { calculateProjection, compareYearMonths, resolveAnchor, type CurrentMonthActuals } from './projection';

interface BookedLike {
  amount: number;
  bookingDate: string;
  status?: string;
}

const BOOKED_BALANCE_TYPES = new Set(['ITBD', 'CLBD', 'OPBD', 'PRCD']);
const AVAILABLE_BALANCE_TYPES = new Set(['ITAV', 'XPCD', 'CLAV', 'OPAV', 'FWAV']);

/**
 * What a bank balance type measures: `booked` (only booked rows), `available`
 * (booked + pending, possibly + a credit facility), or `unknown` (INFO, OTHR,
 * a missing type — treated like booked, the pre-provenance behaviour).
 */
export function balanceBasis(type: string | undefined): 'booked' | 'available' | 'unknown' {
  const t = (type ?? '').toUpperCase();
  if (BOOKED_BALANCE_TYPES.has(t)) return 'booked';
  if (AVAILABLE_BALANCE_TYPES.has(t)) return 'available';
  return 'unknown';
}

/**
 * The day ('yyyy-MM-dd') a bank balance is as of: the bank's reference date
 * when present and not after the sync day, else the sync day. An opening
 * balance (`OPBD`/`OPAV`) of a day equals the previous day's close.
 */
export function resolveBalanceAsOf(
  type: string | undefined,
  referenceDate: string | undefined,
  syncDate: string
): string {
  const day = referenceDate && referenceDate <= syncDate ? referenceDate : syncDate;
  const t = (type ?? '').toUpperCase();
  if (t === 'OPBD' || t === 'OPAV') return format(subDays(parseISO(day), 1), 'yyyy-MM-dd');
  return day;
}

/**
 * The as-of date ('yyyy-MM-dd', server-local like the bank's booking dates) of
 * the resolved anchor when it is a live bank-sync balance, else null: the
 * stored `balanceAsOf`, or — legacy snapshot — the local date of `createdAt`.
 * Mirrors `resolveAnchor`: a snapshot before the genesis month is ignored
 * there, so it is ignored here too.
 */
export function liveAnchorAsOf(
  genesisMonth: YearMonth,
  snapshot: Pick<BalanceSnapshot, 'yearMonth' | 'source' | 'createdAt' | 'balanceAsOf'> | null | undefined
): string | null {
  if (!snapshot || snapshot.source !== 'bank-sync') return null;
  if (compareYearMonths(snapshot.yearMonth, genesisMonth) < 0) return null;
  if (snapshot.balanceAsOf) return snapshot.balanceAsOf;
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
 * Start-of-month balance of `month` behind a balance read as of `asOf`:
 * `balance` minus the net of `month`'s booked rows through `asOf`. When the
 * balance predates the month (e.g. a CLBD for the previous month's last day),
 * the booked rows between `asOf` and the month start are added instead.
 */
export function startOfMonthFromLive(
  balance: number,
  transactions: BookedLike[],
  month: YearMonth,
  asOf: string | null
): number {
  const monthStart = `${month}-01`;
  if (asOf === null || asOf >= monthStart) {
    return balance - netOf(bookedInMonthThrough(transactions, month, asOf));
  }
  const gap = transactions.filter((t) => {
    if (t.status !== undefined && t.status !== 'booked') return false;
    const d = t.bookingDate.slice(0, 10);
    return d > asOf && d < monthStart;
  });
  return balance + netOf(gap);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The provenance `autoAnchorAccount` stores on a bank-sync snapshot, computed
 * from the balance the bank reported and the ledger as it is right after this
 * sync's merge (`transactions`, booked + pending rows of the anchoring links).
 *
 * An available/expected balance also holds the pending rows of its as-of day.
 * The ledger's pending set was fetched on the sync day, so it is subtracted
 * only when the balance is as of the sync day. A HISTORICAL available balance
 * (as of an earlier day, e.g. an `OPAV` or a `CLAV` for yesterday) held the
 * pendings of that day, which may have booked or vanished since and cannot be
 * recovered: its amount is used as the booked-basis balance unchanged and the
 * derived opening is flagged `openingIsEstimate` (the caller records no
 * variance for it; the flag is not persisted). A credit facility inside an
 * available balance cannot be seen and stays in.
 */
export function bankSnapshotProvenance(params: {
  balance: { amount: number; type?: string; referenceDate?: string };
  syncDate: string;
  month: YearMonth;
  transactions: BookedLike[];
}): Required<Pick<BalanceSnapshot, 'balanceAsOf' | 'monthStartBalance'>> &
  Pick<BalanceSnapshot, 'balanceType'> & { openingIsEstimate?: true } {
  const { balance, syncDate, month, transactions } = params;
  const type = balance.type ? balance.type.toUpperCase() : undefined;
  const balanceAsOf = resolveBalanceAsOf(type, balance.referenceDate, syncDate);
  let bookedBalance = balance.amount;
  let openingIsEstimate = false;
  if (balanceBasis(type) === 'available') {
    if (balanceAsOf === syncDate) {
      bookedBalance -= netOf(transactions.filter((t) => t.status === 'pending'));
    } else {
      openingIsEstimate = true;
    }
  }
  return {
    balanceType: type || undefined,
    balanceAsOf,
    monthStartBalance: round2(startOfMonthFromLive(bookedBalance, transactions, month, balanceAsOf)),
    ...(openingIsEstimate ? { openingIsEstimate: true as const } : {}),
  };
}

/**
 * Opening (start-of-`yearMonth`) balance of a live bank-sync snapshot: the
 * stored `monthStartBalance`, or — legacy snapshot — reconstructed from the
 * current ledger through `asOf`.
 */
export function liveAnchorOpeningBalance(
  snapshot: Pick<BalanceSnapshot, 'yearMonth' | 'actualBalance' | 'monthStartBalance'>,
  transactions: BookedLike[],
  asOf: string
): number {
  if (snapshot.monthStartBalance !== undefined) return snapshot.monthStartBalance;
  return startOfMonthFromLive(snapshot.actualBalance, transactions, snapshot.yearMonth, asOf);
}

/**
 * Whether the anchor month gets actualized against booked bank activity:
 *  - the anchor month is the current calendar month (any anchor source), or
 *  - the anchor is a live bank-sync balance (`anchorLiveAsOf` set) from an
 *    EARLIER month — the sync went stale (consent expired, sync failing).
 * A manual/genesis anchor of an earlier month is a plain start-of-month
 * balance whose month is forecast in full. Pure.
 */
export function shouldActualizeAnchorMonth(
  anchorMonth: YearMonth,
  anchorLiveAsOf: string | null,
  currentMonth: YearMonth
): boolean {
  if (anchorMonth === currentMonth) return true;
  return anchorLiveAsOf !== null && compareYearMonths(anchorMonth, currentMonth) < 0;
}

/**
 * The anchor month's start-of-month balance O: a live bank-sync snapshot's
 * opening (`liveAnchorOpeningBalance`: stored `monthStartBalance`, or the
 * legacy reconstruction from `transactions`), else the manual/genesis anchor
 * balance itself (already start-of-month).
 */
export function anchorMonthOpeningBalance(
  genesisMonth: YearMonth,
  genesisBalance: number,
  snapshot: BalanceSnapshot | null | undefined,
  transactions: BookedLike[]
): number {
  const asOf = liveAnchorAsOf(genesisMonth, snapshot);
  if (asOf && snapshot) return liveAnchorOpeningBalance(snapshot, transactions, asOf);
  return resolveAnchor(genesisMonth, genesisBalance, snapshot).startBalance;
}

/**
 * `calculateProjection`'s `currentMonthActuals` for an actualized anchor
 * month: EVERY booked row of `month` in the ledger (no as-of cutoff) plus the
 * month-start balance O. The engine starts the month at O + Σ those rows and
 * marks matching forecast lines paid, so rows and balance always agree.
 */
export function anchorMonthActuals(
  month: YearMonth,
  openingBalance: number,
  transactions: BankTransaction[]
): CurrentMonthActuals {
  return {
    openingBalance: round2(openingBalance),
    transactions: bookedInMonthThrough(transactions, month, null).map((t) => ({
      id: t.id,
      amount: t.amount,
      bookingDate: t.bookingDate,
      counterpartyName: t.counterpartyName,
      remittanceInfo: t.remittanceInfo,
      bankTransactionCode: t.bankTransactionCode,
    })),
  };
}

/**
 * The planned START-of-`month` balance, from the prior anchor:
 *  - same month: the prior anchor's month-start balance O
 *    (`anchorMonthOpeningBalance`) — no forecast involved;
 *  - earlier month: `calculateProjection` (card-paid items excluded, capped at
 *    `month`), actualizing a live prior anchor's month exactly like the
 *    cashflow forecast does (`shouldActualizeAnchorMonth`: start at O + every
 *    booked row of that month, matching forecast lines paid).
 * Mortgage/budget/card-bill transfers are not injected here (background tick,
 * no cached reads), so a month boundary between syncs can still carry their
 * difference. Returns null when no planned row exists for `month` (the prior
 * anchor is later, or the account's custom end date is earlier).
 */
export function plannedOpeningBalance(params: {
  account: FinancialAccount;
  recurringItems: RecurringItem[];
  plannedItems: PlannedItem[];
  taxedIncomes: TaxedIncome[];
  priorSnapshot: BalanceSnapshot | null;
  transactions: BankTransaction[];
  month: YearMonth;
}): number | null {
  const { account, priorSnapshot, transactions, month } = params;
  const anchor = resolveAnchor(account.startingDate, account.startingBalance, priorSnapshot);
  const priorAsOf = liveAnchorAsOf(account.startingDate, priorSnapshot);
  const cmp = compareYearMonths(anchor.startMonth, month);
  if (cmp > 0) return null;

  const opening = anchorMonthOpeningBalance(account.startingDate, account.startingBalance, priorSnapshot, transactions);
  if (cmp === 0) return opening;
  const actuals = shouldActualizeAnchorMonth(anchor.startMonth, priorAsOf, month)
    ? anchorMonthActuals(anchor.startMonth, opening, transactions)
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
  return row ? row.startingBalance : null;
}

/**
 * The `expectedBalance` a bank-sync snapshot records for `month`: the planned
 * opening balance (`plannedOpeningBalance`) plus what the new balance holds on
 * top of its own opening (`actualBalance − monthStartBalance`: the month's
 * booked net through the as-of date, plus pendings for an available balance).
 * So the snapshot's variance is exactly the start-of-month drift (actual
 * opening − planned opening), independent of when in the month the sync ran
 * or which balance type the bank served. Null when no planned row exists.
 */
export function expectedLiveBalance(params: {
  account: FinancialAccount;
  recurringItems: RecurringItem[];
  plannedItems: PlannedItem[];
  taxedIncomes: TaxedIncome[];
  priorSnapshot: BalanceSnapshot | null;
  transactions: BankTransaction[];
  month: YearMonth;
  actualBalance: number;
  monthStartBalance: number;
}): number | null {
  const planned = plannedOpeningBalance(params);
  if (planned === null) return null;
  return round2(planned + (params.actualBalance - params.monthStartBalance));
}
