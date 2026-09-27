/**
 * Pure assembly of the full wealth projection from the raw inputs that the
 * dashboard aggregate reads return (`getOverviewData` / `getGoalsPageData` in
 * `src/lib/actions/dashboard-data.ts`, gathered server-side by
 * `gatherWealthInputs` in `src/lib/wealth-inputs.ts`).
 *
 * Client-safe (no server imports): the engines (`calculateWealthProjection`,
 * `calculateMortgageProjection`) still run in the browser exactly as before —
 * only the data fetching moved server-side. Overview and net-worth goals share
 * this so they can't drift apart.
 */

import { calculateWealthProjection, getLatestEndDate, type WealthProjectionData } from '@/lib/wealth-projection';
import { calculateMortgageProjection } from '@/lib/mortgage-projection';
import { isEuriborUpdateDue } from '@/lib/mortgage-utils';
import { addMonths, compareYearMonths } from '@/lib/projection';
import { computeActualsRollup } from '@/lib/budget-utils';
import { snapshotEntityKey } from '@/lib/latest-snapshots';
import type { CardLiability } from '@/lib/actions/bank';
import type { MortgageProjectionInputsResult } from '@/lib/actions/shared-mortgages';
import type {
  BalanceSnapshot,
  Budget,
  Debt,
  DebtExtraPayment,
  DebtReferenceRate,
  FinancialAccount,
  InvestmentAccount,
  InvestmentContribution,
  MonthlyProjection,
  Receivable,
  ReceivableRepayment,
  WealthProjectionMonth,
  YearMonth,
} from '@/types';

/** One cash account's projection as the wealth engine consumes it. */
export interface CashProjectionSlice {
  monthly: MonthlyProjection[];
  /** Bank-actual past months — only filled for the account(s) that asked for it. */
  retrospective: MonthlyProjection[];
}

export interface WealthMortgageInput {
  name: string;
  inputs: MortgageProjectionInputsResult;
}

/**
 * Everything the wealth projection needs, as plain serializable data. Entity
 * lists hold ACTIVE (non-archived) entities only; child rows are keyed by the
 * parent id; `latestSnapshots` is keyed by `snapshotEntityKey`.
 */
export interface WealthInputs {
  accounts: FinancialAccount[];
  investments: InvestmentAccount[];
  receivables: Receivable[];
  debts: Debt[];
  contributions: Record<string, InvestmentContribution[]>;
  repayments: Record<string, ReceivableRepayment[]>;
  referenceRates: Record<string, DebtReferenceRate[]>;
  extraPayments: Record<string, DebtExtraPayment[]>;
  latestSnapshots: Record<string, BalanceSnapshot>;
  cashProjections: Record<string, CashProjectionSlice>;
  mortgages: WealthMortgageInput[];
  cardLiabilities: CardLiability[];
  splitNetCents: number;
}

export interface WealthAssembly {
  months: WealthProjectionMonth[];
  startDate: YearMonth;
  endDate: YearMonth;
  /** First active mortgage whose yearly Euribor reset is due (reminder banner). */
  euriborDue: { name: string; lastResetDate: Date } | null;
  /** The member's current-month slice across their mortgages, or null. */
  mortgageSlice: { equity: number; liability: number; stake: number } | null;
}

function toMap<T>(record: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(record));
}

function snapshotMap(inputs: WealthInputs, type: 'investment' | 'receivable' | 'debt', ids: string[]) {
  return new Map<string, BalanceSnapshot | null>(
    ids.map((id) => [id, inputs.latestSnapshots[snapshotEntityKey(type, id)] ?? null])
  );
}

/** The engine's input shape, minus the mortgage series (added by `assembleWealthProjection`). */
export function buildWealthProjectionData(inputs: WealthInputs, currentUserId: string | undefined): WealthProjectionData {
  return {
    cashAccounts: inputs.accounts,
    cashProjections: new Map(
      Object.entries(inputs.cashProjections).map(([id, p]) => [id, p.monthly] as [string, MonthlyProjection[]])
    ),
    investments: inputs.investments,
    investmentContributions: toMap(inputs.contributions),
    receivables: inputs.receivables,
    receivableRepayments: toMap(inputs.repayments),
    debts: inputs.debts,
    debtReferenceRates: toMap(inputs.referenceRates),
    debtExtraPayments: toMap(inputs.extraPayments),
    investmentSnapshots: snapshotMap(inputs, 'investment', inputs.investments.map((i) => i.id)),
    receivableSnapshots: snapshotMap(inputs, 'receivable', inputs.receivables.map((r) => r.id)),
    debtSnapshots: snapshotMap(inputs, 'debt', inputs.debts.map((d) => d.id)),
    mortgageProjections: [],
    mortgageNames: [],
    currentUserId,
    cardLiabilities: inputs.cardLiabilities,
    splitNetTotal: inputs.splitNetCents / 100,
  };
}

/**
 * Project mortgages to the wealth horizon, fold them in, and run the wealth
 * engine from `startDate` (the current month).
 */
export function assembleWealthProjection(
  inputs: WealthInputs,
  currentUserId: string | undefined,
  startDate: YearMonth,
  horizonMonths = 60,
  now: Date = new Date()
): WealthAssembly {
  const data = buildWealthProjectionData(inputs, currentUserId);
  const endDate = getLatestEndDate(data, horizonMonths);

  let euriborDue: WealthAssembly['euriborDue'] = null;
  for (const { name, inputs: m } of inputs.mortgages) {
    data.mortgageProjections!.push(calculateMortgageProjection(m, endDate));
    data.mortgageNames!.push(name);
    const due = isEuriborUpdateDue(m.mortgage, m.rates, now);
    if (due.due && !euriborDue) euriborDue = { name, lastResetDate: due.lastResetDate };
  }

  let mortgageSlice: WealthAssembly['mortgageSlice'] = null;
  if (data.mortgageProjections!.length > 0 && currentUserId) {
    let equity = 0, liability = 0, stake = 0;
    for (const proj of data.mortgageProjections!) {
      const row = proj.find((p) => p.yearMonth === startDate) ?? proj[proj.length - 1];
      const pos = row?.members.find((p) => p.userId === currentUserId);
      if (pos) { equity += pos.equity; liability += pos.liability; stake += pos.stake; }
    }
    mortgageSlice = { equity, liability, stake };
  }

  return {
    months: calculateWealthProjection(data, startDate, endDate),
    startDate,
    endDate,
    euriborDue,
    mortgageSlice,
  };
}

/**
 * Each active cash account's current value: its latest real balance (bank-sync
 * or check-in snapshot) when one exists, else the manual starting balance.
 */
export function currentCashBalances(inputs: WealthInputs): Map<string, number> {
  return new Map(
    inputs.accounts.map((a) => [
      a.id,
      inputs.latestSnapshots[snapshotEntityKey('cash-account', a.id)]?.actualBalance ?? a.startingBalance,
    ] as [string, number])
  );
}

/** Card outstanding total + available-of-limit (only cards with a known limit count toward the ratio). */
export function summarizeCardCredit(cards: CardLiability[]): {
  outstandingTotal: number;
  credit: { available: number; limit: number } | null;
} {
  const outstandingTotal = cards.reduce((s, c) => s + c.outstanding, 0);
  const withLimit = cards.filter((c) => typeof c.creditLimit === 'number' && c.creditLimit > 0);
  const limit = withLimit.reduce((s, c) => s + (c.creditLimit ?? 0), 0);
  const available = withLimit.reduce(
    (s, c) => s + (c.availableCredit ?? Math.max(0, (c.creditLimit ?? 0) - c.outstanding)),
    0
  );
  return { outstandingTotal, credit: limit > 0 ? { available, limit } : null };
}

export type BudgetBanner = { type: 'upcoming' | 'over-budget'; budget: Budget; category?: string };

/**
 * At most one budget reminder: an over-budget category on an active confirmed
 * budget beats a confirmed budget starting this or next month.
 */
export function pickBudgetBanner(budgets: Budget[], currentYearMonth: YearMonth): BudgetBanner | null {
  const confirmed = budgets.filter((b) => b.status === 'confirmed' && !b.isArchived);
  for (const b of confirmed) {
    const isActive = compareYearMonths(b.startMonth, currentYearMonth) <= 0 && compareYearMonths(currentYearMonth, b.endMonth) <= 0;
    if (!isActive) continue;
    const over = computeActualsRollup(b).perCategory.find((c) => c.planned > 0 && c.actual > c.planned);
    if (over) return { type: 'over-budget', budget: b, category: over.category };
  }
  const next = addMonths(currentYearMonth, 1);
  const upcoming = confirmed.find((b) => b.startMonth === currentYearMonth || b.startMonth === next);
  if (upcoming && compareYearMonths(currentYearMonth, upcoming.endMonth) <= 0) return { type: 'upcoming', budget: upcoming };
  return null;
}
