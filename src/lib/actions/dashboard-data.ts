'use server';

/**
 * Page-level aggregate READ actions for the heaviest dashboards.
 *
 * Next.js runs client-invoked server actions one at a time (the app-router
 * action queue), so a page that `Promise.all`s many actions still pays one
 * serial HTTP round trip + `auth()` per call — Overview used to make ~34.
 * Each action here authenticates once, validates its (empty) input, fans out
 * server-side in parallel over the cached DB readers / shared helpers, and
 * returns one `ApiResponse<T>`. No mutations and no cache tags of their own:
 * freshness comes from the underlying cached readers' tags, so the pages'
 * refresh-after-mutation callbacks simply call these again.
 */

import { z } from 'zod';
import { format } from 'date-fns';
import { auth } from '@/lib/auth';
import { cachedGetAccounts, cachedGetGoals, cachedGetLatestCompletedSession, cachedGetUserPreferences } from '@/lib/db/cached';
import { computeAccountProjection } from '@/lib/account-projection';
import { gatherWealthInputs, WealthInputError } from '@/lib/wealth-inputs';
import { getBudgets } from '@/lib/actions/budgets';
import {
  getBankConnectionsNeedingAttention,
  getHomeBankGlance,
  type ConnectionAttention,
  type HomeBankAccountGlance,
} from '@/lib/actions/bank';
import { getMySplitGroups, getSplitActivity, getSplitGroupView } from '@/lib/actions/split-groups';
import type { WealthInputs } from '@/lib/wealth-assembly';
import type {
  ApiResponse,
  Budget,
  Currency,
  FinancialAccount,
  Goal,
  ReconciliationSession,
  SplitActivityEvent,
  SplitGroup,
  SplitMemberBalance,
  UserPreferences,
} from '@/types';

// These actions take no arguments; the schema rejects anything a caller
// might smuggle in, keeping the auth → validate → read convention explicit.
const noArgsSchema = z.tuple([]);

/** A non-critical part: failure falls back (logged) instead of failing the page. */
async function soft<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(`Dashboard data: ${label} failed:`, error);
    return fallback;
  }
}

function failure<T>(error: unknown, fallbackMessage: string): ApiResponse<T> {
  if (error instanceof WealthInputError) {
    console.error(`Dashboard data: ${error.message}:`, (error as { cause?: unknown }).cause);
    return { success: false, error: `Couldn't load your ${error.part}. Try again.` };
  }
  console.error(fallbackMessage, error);
  return { success: false, error: fallbackMessage };
}

// ============================================================
// OVERVIEW
// ============================================================

export interface OverviewData {
  /** Every wealth-projection input (required: any failed read fails the action). */
  wealth: WealthInputs;
  /** Month of the latest completed check-in, or null. */
  lastReconciledMonth: string | null;
  budgets: Budget[];
  checkInRemindersEnabled: boolean;
  bankAttention: ConnectionAttention[];
}

/**
 * Everything `/overview` renders, in one round trip. The wealth inputs are
 * REQUIRED — if any of them fails the whole action fails (naming the part), so
 * the page never shows totals computed from a silently-missing collection.
 * Reminder inputs (check-in session, budgets, preferences, bank attention) are
 * non-critical and fall back to "no reminder".
 */
export async function getOverviewData(...args: unknown[]): Promise<ApiResponse<OverviewData>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!noArgsSchema.safeParse(args).success) return { success: false, error: 'Invalid request' };
    const userId = session.user.id;

    const [wealth, lastSession, budgets, prefs, bankAttention] = await Promise.all([
      gatherWealthInputs(userId, { retrospectiveForPrimary: true }),
      soft<ReconciliationSession | null>('check-in session', null, () => cachedGetLatestCompletedSession(userId)),
      soft('budgets', [] as Budget[], async () => {
        const res = await getBudgets();
        return res.success && res.data ? res.data : [];
      }),
      soft<UserPreferences | null>('preferences', null, () => cachedGetUserPreferences(userId)),
      soft('bank attention', [] as ConnectionAttention[], async () => {
        const res = await getBankConnectionsNeedingAttention();
        return res.success && res.data ? res.data : [];
      }),
    ]);

    return {
      success: true,
      data: {
        wealth,
        lastReconciledMonth: lastSession?.yearMonth ?? null,
        budgets,
        checkInRemindersEnabled: prefs ? prefs.checkInRemindersEnabled !== false : true,
        bankAttention,
      },
    };
  } catch (error) {
    return failure(error, 'Failed to load the overview');
  }
}

// ============================================================
// GOALS
// ============================================================

export interface GoalsPageData {
  goals: Goal[];
  /** All accounts (archived included) — the goal dialog's picker and the missing-account warning. */
  accounts: FinancialAccount[];
  /**
   * Wealth inputs (incl. projections for every active AND goal-linked
   * account), or null when no active goal needs projections (all manual).
   */
  wealth: WealthInputs | null;
}

/**
 * `/goals` in one round trip. Projections are computed once: the wealth
 * gather projects every active account plus any (archived) goal-linked
 * account, and the page reuses those series for account-balance goals.
 */
export async function getGoalsPageData(...args: unknown[]): Promise<ApiResponse<GoalsPageData>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!noArgsSchema.safeParse(args).success) return { success: false, error: 'Invalid request' };
    const userId = session.user.id;

    const [goals, accounts] = await Promise.all([cachedGetGoals(userId), cachedGetAccounts(userId)]);
    const activeGoals = goals.filter((g) => !g.isArchived);
    const linkedAccountIds = [...new Set(
      activeGoals
        .filter((g) => g.trackingMethod === 'account-balance' && g.linkedAccountId)
        .map((g) => g.linkedAccountId as string)
    )];

    // The wealth projection is needed for net-worth goals directly AND for the
    // joint plan whenever ANY non-manual goal exists (an account-balance goal's
    // claim also reduces the net-worth pool — see computeGoalPlan).
    const wealth = activeGoals.some((g) => g.trackingMethod !== 'manual')
      ? await gatherWealthInputs(userId, { extraProjectionAccountIds: linkedAccountIds })
      : null;

    return { success: true, data: { goals, accounts, wealth } };
  } catch (error) {
    return failure(error, 'Failed to load goals');
  }
}

// ============================================================
// HOME
// ============================================================

/** Home's "This month" tile: the primary account's current-month row. */
export interface HomeGlance {
  yearMonth: string;
  startingBalance: number;
  totalIncome: number;
  totalExpenses: number;
  endingBalance: number;
  netChange: number;
  currency: Currency;
  isActualized?: boolean;
}

export interface HomeSplitGroupLine {
  group: SplitGroup;
  balances: SplitMemberBalance[];
}

export interface HomeData {
  glance: HomeGlance | null;
  bankGlance: HomeBankAccountGlance[];
  bankAttention: ConnectionAttention[];
  splitGroups: HomeSplitGroupLine[];
  splitActivity: SplitActivityEvent[];
}

/**
 * Home's primary-account glance: the projection runs only up to the current
 * month (`endDate` — the engine stops there; `startDate` is deliberately NOT
 * set because skipped months don't carry their balance forward) and skips the
 * bank retrospective. Returns null when there's no active account or row.
 */
async function computeHomeGlance(userId: string): Promise<HomeGlance | null> {
  const accounts = await cachedGetAccounts(userId);
  const primary = accounts.find((a) => !a.isArchived);
  if (!primary) return null;
  const ym = format(new Date(), 'yyyy-MM');
  // An account that starts in the future has no current-month row — project
  // to its first month instead (the old full-horizon fallback, `monthly[0]`).
  const endDate = primary.startingDate > ym ? primary.startingDate : ym;
  const result = await computeAccountProjection(userId, primary.id, { filters: { endDate } });
  if (!result) return null;
  const row = result.monthly.find((m) => m.yearMonth === ym) ?? result.monthly[0];
  if (!row) return null;
  return {
    yearMonth: row.yearMonth,
    startingBalance: row.startingBalance,
    totalIncome: row.totalIncome,
    totalExpenses: row.totalExpenses,
    endingBalance: row.endingBalance,
    netChange: row.netChange,
    currency: primary.currency,
    isActualized: row.isActualized,
  };
}

async function gatherHomeSplitGroups(): Promise<HomeSplitGroupLine[]> {
  const res = await getMySplitGroups();
  const groups = res.success && res.data ? res.data : [];
  return Promise.all(
    groups.map(async (group) => {
      const view = await getSplitGroupView(group.id);
      return { group, balances: view.success && view.data ? view.data.balances : [] };
    })
  );
}

/**
 * Everything Home renders, in one round trip. Home shows no authoritative
 * totals, so each part keeps the old per-widget behavior: a failing part
 * resolves empty (logged) rather than failing the page. Split recurrence
 * catch-up is a MUTATION and stays a separate call from the client.
 */
export async function getHomeData(...args: unknown[]): Promise<ApiResponse<HomeData>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!noArgsSchema.safeParse(args).success) return { success: false, error: 'Invalid request' };
    const userId = session.user.id;

    const [glance, bankGlance, bankAttention, splitGroups, splitActivity] = await Promise.all([
      soft<HomeGlance | null>('home glance', null, () => computeHomeGlance(userId)),
      soft('bank glance', [] as HomeBankAccountGlance[], async () => {
        const res = await getHomeBankGlance();
        return res.success && res.data ? res.data : [];
      }),
      soft('bank attention', [] as ConnectionAttention[], async () => {
        const res = await getBankConnectionsNeedingAttention();
        return res.success && res.data ? res.data : [];
      }),
      soft('split groups', [] as HomeSplitGroupLine[], () => gatherHomeSplitGroups()),
      soft('split activity', [] as SplitActivityEvent[], async () => {
        const res = await getSplitActivity(5);
        return res.success && res.data ? res.data : [];
      }),
    ]);

    return { success: true, data: { glance, bankGlance, bankAttention, splitGroups, splitActivity } };
  } catch (error) {
    return failure(error, 'Failed to load home');
  }
}
