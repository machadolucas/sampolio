/**
 * One account's cashflow projection, computed server-side (plain module — NOT
 * 'use server': it takes a `userId`, so it must never become a client-invokable
 * endpoint; same pattern as `projection-inputs.ts`).
 *
 * The single place that turns `gatherProjectionInputs` + card-bill transfers
 * into `calculateProjection` output, shared by the `getProjection` action and
 * the dashboard aggregate reads (`src/lib/actions/dashboard-data.ts`) so they
 * can never drift apart.
 */

import { calculateProjection, getUniqueCategories, resolveAnchor } from '@/lib/projection';
import {
  gatherProjectionInputs,
  computeCardBillTransfersForAccount,
  getLinkedCashBankTransactions,
  getCardPaymentSourcesForAccount,
  type BankDataLoader,
} from '@/lib/projection-inputs';
import { calculateRetrospective } from '@/lib/retrospective';
import type {
  MonthlyProjection,
  ProjectionFilters,
  SalaryConfig,
  TaxedIncome,
  FinancialAccount,
  BalanceSnapshot,
} from '@/types';

export interface AccountProjectionResult {
  monthly: MonthlyProjection[];
  /**
   * Past months reconstructed purely from booked bank transactions. Empty
   * unless requested (`withRetrospective`) AND a bank cash/savings account is
   * linked with synced data.
   */
  retrospective: MonthlyProjection[];
  categories: string[];
  salaryConfigs: SalaryConfig[];
  taxedIncomes: TaxedIncome[];
  account: FinancialAccount;
}

export interface AccountProjectionOptions {
  /**
   * Engine filters. Prefer `endDate` alone for a short window: `startDate`
   * skips months WITHOUT carrying their balance forward, so it is only safe
   * when it is at or before the anchor month.
   */
  filters?: ProjectionFilters;
  /** Also reconstruct the bank-actuals retrospective (default false). */
  withRetrospective?: boolean;
}

/** Returns null when the account doesn't exist (or isn't this user's). */
export async function computeAccountProjection(
  userId: string,
  accountId: string,
  options: AccountProjectionOptions = {}
): Promise<AccountProjectionResult | null> {
  // Account, items, anchor snapshot, and the injected mortgage/budget
  // transfer lines — shared with the scenario action via projection-inputs.
  const inputs = await gatherProjectionInputs(userId, accountId);
  if (!inputs) return null;
  const {
    account,
    recurringItems,
    plannedItems,
    salaryConfigs,
    taxedIncomes,
    latestSnapshot,
    mortgageTransfers,
    budgetTransfers,
    goalTransfers,
    tripTransfers,
    currentMonthActuals,
    anchorLiveAsOf,
    anchorMonthStartBalance,
    bankData,
    directRecurring,
    directPlanned,
  } = inputs;

  // Computed read-only credit-card bill lines (from the FULL item lists —
  // tagged card spend feeds the forecast cycles) plus, when asked, the
  // bank-actuals retrospective. Both reuse the inputs' memoized bank reads,
  // so each linked ledger is decoded once per projection.
  const [cardBillTransfers, retrospective] = await Promise.all([
    // Forecast bills past the engine's end month are never used (the Home
    // glance projects to the current month only).
    computeCardBillTransfersForAccount(
      userId, accountId, account, recurringItems, plannedItems, bankData, options.filters?.endDate
    ),
    options.withRetrospective
      ? getRetrospectiveForAccount(
          userId, accountId, account, latestSnapshot, anchorLiveAsOf, anchorMonthStartBalance, bankData
        )
      : Promise.resolve<MonthlyProjection[]>([]),
  ]);

  const monthly = calculateProjection(
    account,
    directRecurring,
    directPlanned,
    taxedIncomes,
    options.filters,
    latestSnapshot,
    mortgageTransfers,
    budgetTransfers,
    cardBillTransfers,
    currentMonthActuals,
    goalTransfers,
    tripTransfers
  );

  return {
    monthly,
    retrospective,
    categories: getUniqueCategories(recurringItems, plannedItems),
    salaryConfigs,
    taxedIncomes,
    account,
  };
}

/**
 * Reconstruct up to `RETROSPECTIVE_MONTHS_BACK` (24) past months purely from
 * real booked bank transactions for the cash/savings bank accounts that anchor
 * this cash account. These sit to the LEFT of the forecast on the cashflow
 * page. Returns [] when no bank cash/savings account is linked (so non-bank
 * accounts are unaffected) or when there's no usable history. The chain runs
 * backward from the anchor month's start-of-month balance
 * (`anchorMonthStartBalance`, the same O the forecast starts from). A bank
 * problem must never break the core cashflow projection.
 */
async function getRetrospectiveForAccount(
  userId: string,
  accountId: string,
  account: FinancialAccount,
  latestSnapshot: BalanceSnapshot | null,
  anchorLiveAsOf: string | null,
  anchorMonthStartBalance: number | null,
  bankData: BankDataLoader
): Promise<MonthlyProjection[]> {
  try {
    const [transactions, cardPayments] = await Promise.all([
      getLinkedCashBankTransactions(userId, accountId, bankData),
      getCardPaymentSourcesForAccount(userId, accountId, bankData),
    ]);
    if (transactions.length === 0) return [];

    const anchor = resolveAnchor(account.startingDate, account.startingBalance, latestSnapshot);
    return calculateRetrospective({
      accountId,
      transactions,
      anchor,
      cardPayments,
      anchorLiveAsOf,
      anchorMonthStartBalance,
    });
  } catch (error) {
    console.error('Retrospective reconstruction failed:', error);
    return [];
  }
}
