/**
 * Server-side gathering of every wealth-projection input in ONE request
 * (plain module — NOT 'use server': the helpers take a `userId` and must
 * never become client-invokable endpoints).
 *
 * Next runs client-invoked server actions one at a time, so the old
 * client-side fan-out (one action per entity per child collection) was ~30+
 * serial round trips. Here everything runs in parallel over the cached DB
 * readers: `cachedGetWealthData` (entities + child rows), one
 * `cachedGetLatestSnapshotsByEntity` decrypt, per-account
 * `computeAccountProjection`, and the member's mortgages.
 *
 * Failure semantics: every part is REQUIRED — a failing read rejects with a
 * `WealthInputError` naming the part, so callers can refuse to show partial
 * (silently wrong) totals instead of substituting [] / 0.
 */

import {
  cachedGetAccounts,
  cachedGetWealthData,
  cachedGetLatestSnapshotsByEntity,
  cachedGetMortgagesForUser,
  cachedGetMortgageProjectionData,
} from '@/lib/db/cached';
import { computeAccountProjection } from '@/lib/account-projection';
import { getCardLiabilities } from '@/lib/actions/bank';
import { getMySplitNetBalance } from '@/lib/actions/split-groups';
import type { ApiResponse } from '@/types';
import type { CashProjectionSlice, WealthInputs, WealthMortgageInput } from '@/lib/wealth-assembly';

/** A required wealth input could not be read; `part` is user-presentable. */
export class WealthInputError extends Error {
  constructor(public readonly part: string, cause?: unknown) {
    super(`Failed to load ${part}`);
    this.name = 'WealthInputError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Run `fn`, re-throwing any failure as a `WealthInputError` for `part`. */
export async function requirePart<T>(part: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof WealthInputError) throw error;
    throw new WealthInputError(part, error);
  }
}

/** Unwrap an `ApiResponse` from a reused read action, failing the part on `success: false`. */
export function unwrapPart<T>(part: string, res: ApiResponse<T>): T {
  if (!res.success || res.data === undefined) throw new WealthInputError(part, res.error);
  return res.data;
}

export interface GatherWealthInputsOptions {
  /**
   * Also reconstruct the bank-actual retrospective for the primary (first
   * active) account — the Overview "Plan check" card needs it.
   */
  retrospectiveForPrimary?: boolean;
  /**
   * Extra (e.g. archived) account ids to project besides the active ones —
   * returned in `cashProjections` but NOT added to `accounts`, so they never
   * enter the wealth totals.
   */
  extraProjectionAccountIds?: string[];
}

export async function gatherWealthInputs(
  userId: string,
  options: GatherWealthInputsOptions = {}
): Promise<WealthInputs> {
  const [allAccounts, wealth, latestSnapshots, mortgages, cardLiabilities, splitNet] = await Promise.all([
    requirePart('cash accounts', () => cachedGetAccounts(userId)),
    requirePart('investments, receivables and debts', () => cachedGetWealthData(userId)),
    requirePart('latest balances', () => cachedGetLatestSnapshotsByEntity(userId)),
    requirePart('shared mortgages', () => gatherMortgages(userId)),
    // Reused read actions (auth() is request-deduped) — their logic stays in one place.
    requirePart('credit cards', async () => unwrapPart('credit cards', await getCardLiabilities())),
    requirePart('split balances', async () => unwrapPart('split balances', await getMySplitNetBalance())),
  ]);

  const accounts = allAccounts.filter((a) => !a.isArchived);
  const retrospectiveId = options.retrospectiveForPrimary ? accounts[0]?.id : undefined;
  const projectionIds = [...new Set([...accounts.map((a) => a.id), ...(options.extraProjectionAccountIds ?? [])])]
    .filter((id) => allAccounts.some((a) => a.id === id));

  const projections = await requirePart('cash projections', () =>
    Promise.all(
      projectionIds.map(async (id) => {
        const result = await computeAccountProjection(userId, id, { withRetrospective: id === retrospectiveId });
        if (!result) throw new WealthInputError('cash projections');
        return [id, { monthly: result.monthly, retrospective: result.retrospective }] as [string, CashProjectionSlice];
      })
    )
  );

  const investments = wealth.investments.filter((i) => !i.isArchived);
  const receivables = wealth.receivables.filter((r) => !r.isArchived);
  const debts = wealth.debts.filter((d) => !d.isArchived);

  return {
    accounts,
    // Strip the embedded child arrays — they travel keyed by parent id below.
    investments: investments.map((i) => omit(i, 'contributions')),
    receivables: receivables.map((r) => omit(r, 'repayments')),
    debts: debts.map((d) => omit(d, 'referenceRates', 'extraPayments')),
    contributions: Object.fromEntries(investments.map((i) => [i.id, i.contributions])),
    repayments: Object.fromEntries(receivables.map((r) => [r.id, r.repayments])),
    referenceRates: Object.fromEntries(debts.map((d) => [d.id, d.referenceRates])),
    extraPayments: Object.fromEntries(debts.map((d) => [d.id, d.extraPayments])),
    latestSnapshots,
    cashProjections: Object.fromEntries(projections),
    mortgages,
    cardLiabilities,
    splitNetCents: splitNet.netCents,
  };
}

function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const copy: Partial<T> = { ...obj };
  for (const k of keys) delete copy[k];
  return copy as Omit<T, K>;
}

/**
 * The member's active shared mortgages with their projection inputs. A
 * mortgage that vanished or no longer lists the user (stale membership entry)
 * is skipped, exactly as the per-mortgage action's access check did.
 */
async function gatherMortgages(userId: string): Promise<WealthMortgageInput[]> {
  const active = (await cachedGetMortgagesForUser(userId)).filter((m) => !m.isArchived);
  const loaded = await Promise.all(active.map((m) => cachedGetMortgageProjectionData(m.id)));
  const out: WealthMortgageInput[] = [];
  loaded.forEach((data, idx) => {
    if (!data || !data.mortgage.members.some((m) => m.userId === userId)) return;
    out.push({ name: active[idx].name, inputs: data });
  });
  return out;
}
