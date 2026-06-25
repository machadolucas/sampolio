'use server';

import { auth } from '@/lib/auth';
import {
  cachedGetAccounts,
  cachedGetAccountById,
  cachedGetAccountProjectionData,
  cachedGetLatestSnapshot,
  cachedGetMortgagesForUser,
  cachedGetMortgageProjectionData,
  cachedGetBudgets,
  cachedGetBankConnections,
  cachedGetBankTransactions,
} from '@/lib/db/cached';
import { calculateProjection, calculateYearlyRollups, getUniqueCategories, addMonths, type MortgageTransfer, type BudgetTransfer, type CardBillTransfer } from '@/lib/projection';
import { calculateMortgageProjection, getMortgageStartDate } from '@/lib/mortgage-projection';
import { computeBudgetTransfers } from '@/lib/budget-utils';
import { computeCardBilling } from '@/lib/bank/card-billing';
import type { ApiResponse, MonthlyProjection, YearlyRollup, ProjectionFilters, SalaryConfig } from '@/types';

interface ProjectionResponse {
  monthly: MonthlyProjection[];
  yearly: YearlyRollup[];
  categories: string[];
  salaryConfigs: SalaryConfig[];
  account: {
    id: string;
    name: string;
    currency: string;
    startingBalance: number;
    startingDate: string;
  };
}

export async function getProjection(
  accountId: string,
  filters?: ProjectionFilters
): Promise<ApiResponse<ProjectionResponse>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const account = await cachedGetAccountById(session.user.id, accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const [{ recurringItems, plannedItems, salaryConfigs, taxedIncomes }, latestSnapshot] = await Promise.all([
      cachedGetAccountProjectionData(session.user.id, accountId),
      cachedGetLatestSnapshot(session.user.id, 'cash-account', accountId),
    ]);

    // Computed read-only lines: mortgage payments, confirmed budgets, and linked
    // credit-card bills paid from this account.
    const [mortgageTransfers, budgetTransfers, cardBillTransfers] = await Promise.all([
      getMortgageTransfersForAccount(session.user.id, accountId),
      getBudgetTransfersForAccount(session.user.id, accountId),
      getCardBillTransfersForAccount(session.user.id, accountId),
    ]);

    const monthly = calculateProjection(account, recurringItems, plannedItems, taxedIncomes, filters, latestSnapshot, mortgageTransfers, budgetTransfers, cardBillTransfers);
    const yearly = calculateYearlyRollups(monthly);
    const categories = getUniqueCategories(recurringItems, plannedItems);

    return {
      success: true,
      data: {
        monthly,
        yearly,
        categories,
        salaryConfigs,
        account: {
          id: account.id,
          name: account.name,
          currency: account.currency,
          startingBalance: account.startingBalance,
          startingDate: account.startingDate,
        },
      },
    };
  } catch (error) {
    console.error('Get projection error:', error);
    return { success: false, error: 'Failed to calculate projection' };
  }
}

export interface CombinedAccountsMonth {
  yearMonth: string;
  totalIncome: number;
  totalExpenses: number;
  netChange: number;
  endingBalance: number; // sum of every account's balance that month (carried forward)
  perAccount: { accountId: string; endingBalance: number }[];
}

export interface CombinedAccountsProjectionResponse {
  currency: string; // primary account's currency (display)
  mixedCurrencies: boolean;
  accounts: { id: string; name: string; currency: string }[];
  months: CombinedAccountsMonth[];
}

/**
 * Read-only "All accounts" combined cashflow: each account's own projection
 * (with its mortgage/budget injections + snapshot anchoring) summed per month.
 * Balances carry forward for months outside an account's own window so the
 * combined balance line is continuous. The forecasting engine is untouched —
 * this is a pure aggregation over the existing per-account projections.
 */
export async function getCombinedAccountsProjection(
  filters?: ProjectionFilters
): Promise<ApiResponse<CombinedAccountsProjectionResponse>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const userId = session.user.id;

    const accounts = (await cachedGetAccounts(userId)).filter((a) => !a.isArchived);
    if (accounts.length === 0) {
      return { success: true, data: { currency: 'EUR', mixedCurrencies: false, accounts: [], months: [] } };
    }

    const perAccount = await Promise.all(
      accounts.map(async (account) => {
        const [{ recurringItems, plannedItems, taxedIncomes }, latestSnapshot] = await Promise.all([
          cachedGetAccountProjectionData(userId, account.id),
          cachedGetLatestSnapshot(userId, 'cash-account', account.id),
        ]);
        const [mortgageTransfers, budgetTransfers, cardBillTransfers] = await Promise.all([
          getMortgageTransfersForAccount(userId, account.id),
          getBudgetTransfersForAccount(userId, account.id),
          getCardBillTransfersForAccount(userId, account.id),
        ]);
        const monthly = calculateProjection(
          account,
          recurringItems,
          plannedItems,
          taxedIncomes,
          filters,
          latestSnapshot,
          mortgageTransfers,
          budgetTransfers,
          cardBillTransfers
        );
        return { account, monthly };
      })
    );

    // Union of all months, sorted ascending.
    const monthSet = new Set<string>();
    for (const { monthly } of perAccount) for (const m of monthly) monthSet.add(m.yearMonth);
    const months = [...monthSet].sort((a, b) => a.localeCompare(b));

    const combined: CombinedAccountsMonth[] = months.map((ym) => {
      let totalIncome = 0;
      let totalExpenses = 0;
      let endingBalance = 0;
      const acctBreakdown: { accountId: string; endingBalance: number }[] = [];

      for (const { account, monthly } of perAccount) {
        const row = monthly.find((m) => m.yearMonth === ym);
        let bal: number;
        if (row) {
          totalIncome += row.totalIncome;
          totalExpenses += row.totalExpenses;
          bal = row.endingBalance;
        } else if (monthly.length > 0 && ym < monthly[0].yearMonth) {
          // before this account's window → its starting balance
          bal = monthly[0].startingBalance;
        } else if (monthly.length > 0) {
          // after its window → carry the last known ending balance
          bal = monthly[monthly.length - 1].endingBalance;
        } else {
          bal = account.startingBalance;
        }
        endingBalance += bal;
        acctBreakdown.push({ accountId: account.id, endingBalance: bal });
      }

      return {
        yearMonth: ym,
        totalIncome,
        totalExpenses,
        netChange: totalIncome - totalExpenses,
        endingBalance,
        perAccount: acctBreakdown,
      };
    });

    const currency = accounts[0].currency;
    const mixedCurrencies = accounts.some((a) => a.currency !== currency);

    return {
      success: true,
      data: {
        currency,
        mixedCurrencies,
        accounts: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
        months: combined,
      },
    };
  } catch (error) {
    console.error('Combined accounts projection error:', error);
    return { success: false, error: 'Failed to calculate combined projection' };
  }
}

/**
 * Per-month mortgage transfers this user owes from a given cash account. For each
 * shared mortgage where the user's membership links to `accountId`, run the
 * amortization engine and emit the user's `monthlyDeposit` per month. Returns []
 * when no mortgage is linked, so accounts without a mortgage are unaffected.
 */
async function getMortgageTransfersForAccount(userId: string, accountId: string): Promise<MortgageTransfer[]> {
  const transfers: MortgageTransfer[] = [];
  try {
    const mortgages = await cachedGetMortgagesForUser(userId);
    for (const m of mortgages) {
      if (m.isArchived) continue;
      const me = m.members.find((mem) => mem.userId === userId);
      if (!me || me.linkedAccountId !== accountId) continue;

      const inputs = await cachedGetMortgageProjectionData(m.id);
      if (!inputs) continue;
      const genesis = getMortgageStartDate(inputs.mortgage);
      const maxTerm = Math.max(...inputs.mortgage.loans.map((l) => l.originalTermMonths), 12);
      const end = addMonths(genesis, maxTerm + 24);
      const months = calculateMortgageProjection(inputs, end);

      for (const mm of months) {
        const pos = mm.members.find((p) => p.userId === userId);
        if (pos && pos.monthlyDeposit > 0.005) {
          transfers.push({
            yearMonth: mm.yearMonth,
            mortgageId: m.id,
            mortgageName: inputs.mortgage.name,
            amount: pos.monthlyDeposit,
          });
        }
      }
    }
  } catch (error) {
    // A mortgage problem must never break the core cashflow projection.
    console.error('Mortgage transfer injection failed:', error);
  }
  return transfers;
}

/**
 * Per-month credit-card bills for cards PAID FROM this account, computed by the
 * card-billing engine from each linked card's cycle config + transactions.
 * Returns [] when no card is linked, so other accounts are unaffected. A card
 * problem must never break the core cashflow projection.
 */
async function getCardBillTransfersForAccount(userId: string, accountId: string): Promise<CardBillTransfer[]> {
  const transfers: CardBillTransfer[] = [];
  try {
    const connections = await cachedGetBankConnections(userId);
    for (const conn of connections) {
      for (const link of conn.linkedAccounts) {
        if (link.accountRole !== 'credit-card' || link.isExcluded) continue;
        if (link.linkedFinancialAccountId !== accountId) continue;
        const txs = await cachedGetBankTransactions(userId, link.id);
        const result = computeCardBilling({
          statementDay: link.statementDay,
          paymentDueDay: link.paymentDueDay,
          outstanding: link.outstanding,
          lastStatementBalance: link.lastStatementBalance,
          transactions: txs.map((t) => ({ bookingDate: t.bookingDate, amount: t.amount })),
          includeOpenCycleEstimate: link.includeOpenCycleEstimate,
        });
        for (const bill of result.bills) {
          transfers.push({
            yearMonth: bill.billYearMonth,
            linkId: link.id,
            cardName: link.name ?? `${conn.aspspName} card`,
            amount: bill.amount,
            isEstimate: bill.isEstimate,
          });
        }
      }
    }
  } catch (error) {
    console.error('Card bill injection failed:', error);
  }
  return transfers;
}

/**
 * Per-month flows of the user's confirmed budgets linked to this account
 * (planned costs out, usable funding in), computed by the budget engine.
 * Returns [] when no budget is linked, so other accounts are unaffected.
 */
async function getBudgetTransfersForAccount(userId: string, accountId: string): Promise<BudgetTransfer[]> {
  try {
    const budgets = await cachedGetBudgets(userId);
    return budgets
      .filter(b => b.status === 'confirmed' && !b.isArchived && b.linkedAccountId === accountId)
      .flatMap(b => computeBudgetTransfers(b));
  } catch (error) {
    // A budget problem must never break the core cashflow projection.
    console.error('Budget transfer injection failed:', error);
    return [];
  }
}
