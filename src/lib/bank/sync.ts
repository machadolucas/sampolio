/**
 * Enable Banking — sync engine (server-only).
 *
 * Pulls balances + transactions for a connection's accounts and writes them to
 * the local encrypted cache. Cache-first by contract: this is the ONLY place
 * (besides the consent callback) that touches the bank API. Per-account
 * try/catch isolation means one bank/account failing never breaks the others.
 * Writes are serialized per connection by an in-process lock (no file locking
 * exists). Idempotent: overlapping windows are absorbed by the dedup upsert.
 */

import { v4 as uuidv4 } from 'uuid';
import { updateTag } from 'next/cache';
import type {
  BankAccountLink,
  BankConnection,
  BankSyncRun,
  BankSyncRunAccountResult,
  BankSyncTrigger,
  BankTransaction,
} from '@/types';
import {
  getBankConnectionById,
  updateBankConnection,
  getBankSessionSecret,
} from '@/lib/db/bank-connections';
import { getBankTransactions, writeBankTransactions } from '@/lib/db/bank-transactions';
import { appendBankSyncRun } from '@/lib/db/bank-sync-runs';
import { getAccountById } from '@/lib/db/accounts';
import { getRecurringItems } from '@/lib/db/recurring-items';
import { getPlannedItems } from '@/lib/db/planned-items';
import { getTaxedIncomes } from '@/lib/db/taxed-income';
import { getLatestSnapshot, createBalanceSnapshot } from '@/lib/db/reconciliation';
import { calculateProjection, getCurrentYearMonth } from '@/lib/projection';
import {
  getAccountBalances,
  getAccountTransactions,
  BankApiError,
  redactBankError,
} from './client';
import { mapBalances, mapTransactions, pickAnchorBalance } from './mappers';
import { mergeTransactions } from './dedup';
import {
  BACKFILL_DAYS,
  INCREMENTAL_OVERLAP_DAYS,
  MAX_SCHEDULED_FETCHES_PER_DAY,
  RATE_LIMIT_BACKOFF_MS,
  TRANSIENT_BACKOFF_MS,
} from './constants';

// ---------- per-connection in-process lock ----------
const inFlight = new Map<string, Promise<BankSyncRun>>();

// ---------- date helpers (UTC, YYYY-MM-DD) ----------
function todayYmd(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
function subDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Invalidate cache tags, tolerating a missing request scope (background tick). */
function safeUpdateTags(tags: string[]): void {
  for (const tag of tags) {
    try {
      updateTag(tag);
    } catch {
      // No request scope (scheduler tick) — disk is the source of truth; the
      // next request-scoped mutation / "Refresh now" will revalidate.
    }
  }
}

export interface SyncOptions {
  psuIp?: string; // present ⇒ PSU-IP-Address sent (higher rate allowance)
}

/** Run a sync for one connection, serialized per connection. */
export function runSync(
  userId: string,
  connectionId: string,
  trigger: BankSyncTrigger,
  opts: SyncOptions = {},
  now: number = Date.now()
): Promise<BankSyncRun> {
  const existing = inFlight.get(connectionId);
  if (existing) return existing;
  const promise = doRunSync(userId, connectionId, trigger, opts, now).finally(() => {
    inFlight.delete(connectionId);
  });
  inFlight.set(connectionId, promise);
  return promise;
}

async function doRunSync(
  userId: string,
  connectionId: string,
  trigger: BankSyncTrigger,
  opts: SyncOptions,
  now: number
): Promise<BankSyncRun> {
  const nowIso = new Date(now).toISOString();
  const run: BankSyncRun = {
    id: uuidv4(),
    connectionId,
    trigger,
    startedAt: nowIso,
    status: 'ok',
    perAccount: [],
    psuPresent: !!opts.psuIp,
  };

  const connection = await getBankConnectionById(userId, connectionId);
  if (!connection) {
    run.status = 'error';
    run.error = 'NOT_FOUND';
    run.finishedAt = new Date().toISOString();
    return run;
  }

  if (connection.status === 'expired' || connection.status === 'revoked') {
    run.status = 'error';
    run.error = 'EXPIRED_SESSION';
    run.finishedAt = new Date().toISOString();
    await appendBankSyncRun(userId, connectionId, run);
    return run;
  }

  const secret = await getBankSessionSecret(userId, connectionId);
  if (!secret?.sessionId) {
    run.status = 'error';
    run.error = 'NO_SESSION';
    run.finishedAt = new Date().toISOString();
    await appendBankSyncRun(userId, connectionId, run);
    return run;
  }

  const accounts = connection.linkedAccounts.filter((l) => !l.isExcluded);
  const today = todayYmd(now);

  let anyExpired = false;
  let anyRateLimited = false;
  let anyTransient = false;
  let anySuccess = false;
  const touchedTags = new Set<string>();
  const updatedLinks: BankAccountLink[] = [...connection.linkedAccounts];

  for (const link of accounts) {
    const result: BankSyncRunAccountResult = {
      linkedAccountId: link.id,
      balanceFetched: false,
      txAdded: 0,
      txUpdated: 0,
    };

    try {
      const isBackfill = !link.syncCursor?.backfilledThrough;
      const fromDate = isBackfill
        ? subDaysYmd(today, BACKFILL_DAYS)
        : subDaysYmd(link.syncCursor?.lastBookingDate ?? today, INCREMENTAL_OVERLAP_DAYS);
      result.fromDate = fromDate;
      result.toDate = today;

      // --- transactions (paginated) ---
      const incoming: BankTransaction[] = [];
      let continuationKey: string | undefined;
      let guard = 0;
      do {
        const raw = await getAccountTransactions(
          link.accountUid,
          {
            dateFrom: fromDate,
            dateTo: today,
            continuationKey,
            strategy: isBackfill ? 'longest' : 'default',
          },
          opts.psuIp
        );
        const mapped = mapTransactions(raw, link.id, nowIso, () => uuidv4());
        incoming.push(...mapped.transactions);
        continuationKey = mapped.continuationKey;
      } while (continuationKey && ++guard < 50);

      const prior = await getBankTransactions(userId, link.id);
      const { merged, added, updated } = mergeTransactions(prior, incoming, nowIso);
      await writeBankTransactions(userId, link.id, merged);
      result.txAdded = added;
      result.txUpdated = updated;
      touchedTags.add(`user:${userId}:bank-account:${link.id}:transactions`);

      // --- balances ---
      const rawBal = await getAccountBalances(link.accountUid, opts.psuIp);
      const balances = mapBalances(rawBal);
      const anchorBalance = pickAnchorBalance(balances);
      result.balanceFetched = !!anchorBalance;

      const isCard = link.accountRole === 'credit-card';
      const newCursor = {
        lastBookingDate: merged[0]?.bookingDate ?? link.syncCursor?.lastBookingDate,
        lastSeenEntryRefs: merged.slice(0, 25).map((t) => t.dedupKey),
        backfilledThrough: isBackfill ? today : link.syncCursor?.backfilledThrough ?? today,
      };

      const idx = updatedLinks.findIndex((l) => l.id === link.id);
      if (idx >= 0) {
        updatedLinks[idx] = {
          ...updatedLinks[idx],
          lastBalance: anchorBalance?.amount ?? updatedLinks[idx].lastBalance,
          lastBalanceType: anchorBalance?.type ?? updatedLinks[idx].lastBalanceType,
          lastBalanceAt: anchorBalance ? nowIso : updatedLinks[idx].lastBalanceAt,
          outstanding: isCard && anchorBalance ? Math.max(0, -anchorBalance.amount) : updatedLinks[idx].outstanding,
          syncCursor: newCursor,
        };
      }

      // --- auto-anchor (keystone): cash/savings balance → BalanceSnapshot ---
      if (
        anchorBalance &&
        (link.accountRole === 'cash' || link.accountRole === 'savings') &&
        link.linkedFinancialAccountId
      ) {
        const anchored = await autoAnchorAccount(
          userId,
          link.linkedFinancialAccountId,
          anchorBalance.amount
        );
        if (anchored) touchedTags.add(`user:${userId}:reconciliation`);
      }

      anySuccess = true;
    } catch (err) {
      result.error = redactBankError(err);
      if (err instanceof BankApiError) {
        if (err.code === 'EXPIRED_SESSION') anyExpired = true;
        else if (err.code === 'RATE_LIMITED') {
          anyRateLimited = true;
          result.rateLimited = true;
        } else if (err.code === 'TRANSIENT' || err.code === 'BAD_RESPONSE') {
          anyTransient = true;
        }
      } else {
        anyTransient = true;
      }
      // No mutation on a failed fetch beyond recording the error.
      console.error(`[bank-sync] account fetch failed (${connection.aspspName}):`, result.error);
    }

    run.perAccount.push(result);
  }

  // ---- aggregate status + next-due scheduling ----
  const failed = run.perAccount.filter((r) => r.error).length;
  run.status = failed === 0 ? 'ok' : anySuccess ? 'partial' : 'error';
  run.finishedAt = new Date().toISOString();

  const normalIntervalMs = Math.floor((24 * 60 * 60 * 1000) / MAX_SCHEDULED_FETCHES_PER_DAY);
  let nextSyncDueAt: string | undefined;
  if (anyExpired) {
    nextSyncDueAt = undefined; // stop until reconnect
  } else if (anyRateLimited) {
    nextSyncDueAt = new Date(now + RATE_LIMIT_BACKOFF_MS).toISOString();
  } else if (anyTransient) {
    nextSyncDueAt = new Date(now + TRANSIENT_BACKOFF_MS).toISOString();
  } else {
    nextSyncDueAt = new Date(now + normalIntervalMs).toISOString();
  }

  const connUpdate: Partial<Omit<BankConnection, 'id' | 'userId' | 'createdAt'>> = {
    linkedAccounts: updatedLinks,
    lastSyncAt: nowIso,
    lastSyncStatus: run.status,
    lastError: run.perAccount.find((r) => r.error)?.error,
    nextSyncDueAt,
  };
  if (anyExpired) connUpdate.status = 'expired';

  await updateBankConnection(userId, connectionId, connUpdate);
  await appendBankSyncRun(userId, connectionId, run);

  touchedTags.add(`user:${userId}:bank-connections`);
  touchedTags.add(`user:${userId}:bank-connection:${connectionId}`);
  touchedTags.add(`user:${userId}:bank-connection:${connectionId}:runs`);
  safeUpdateTags([...touchedTags]);

  return run;
}

/**
 * Write a `source:'bank-sync'` BalanceSnapshot for the current month so the
 * forecast re-anchors on the real balance via `resolveAnchor`. The DB layer
 * enforces manual-wins, so a user's hand-confirmed balance is never clobbered.
 * Returns true when a snapshot was (re)written.
 */
async function autoAnchorAccount(
  userId: string,
  financialAccountId: string,
  actualBalance: number
): Promise<boolean> {
  const account = await getAccountById(userId, financialAccountId);
  if (!account) return false;

  const currentMonth = getCurrentYearMonth();

  // Baseline projection (anchored on the latest EXISTING snapshot) to estimate
  // what the system expected for the current month → variance for the record.
  const [recurringItems, plannedItems, taxedIncomes, priorSnapshot] = await Promise.all([
    getRecurringItems(userId, financialAccountId),
    getPlannedItems(userId, financialAccountId),
    getTaxedIncomes(userId, financialAccountId),
    getLatestSnapshot(userId, 'cash-account', financialAccountId),
  ]);
  const monthly = calculateProjection(
    account,
    recurringItems,
    plannedItems,
    taxedIncomes,
    undefined,
    priorSnapshot
  );
  const row = monthly.find((m) => m.yearMonth === currentMonth);
  const expected = row?.endingBalance ?? priorSnapshot?.actualBalance ?? account.startingBalance;

  const snapshot = await createBalanceSnapshot(
    userId,
    'cash-account',
    financialAccountId,
    currentMonth,
    expected,
    actualBalance,
    'bank-sync'
  );
  // createBalanceSnapshot returns the existing manual snapshot unchanged when
  // manual-wins applies; detect a real write by matching the source.
  return snapshot.source === 'bank-sync';
}
