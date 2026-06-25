/**
 * Enable Banking — background scheduler (in-process, single node).
 *
 * One idempotent `setInterval` ticks every ~30 min and runs any connection whose
 * disk-anchored `nextSyncDueAt` has passed. Because that cursor lives on disk, a
 * restart delays a sync by at most one tick (the backfill is callback-driven and
 * cursor-resumable). A per-account daily budget keeps a safety margin under the
 * bank's per-account limit so on-demand "Refresh now" never gets starved. The
 * per-connection lock + status handling live in the sync engine.
 */

import { getAllUsers } from '@/lib/db/users';
import { getBankConnections } from '@/lib/db/bank-connections';
import { runSync } from './sync';
import { redactBankError } from './client';
import {
  SCHEDULER_TICK_MS,
  MAX_SCHEDULED_FETCHES_PER_DAY,
  isBankFeatureConfigured,
} from './constants';

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

// Per-account scheduled-fetch counter, reset each UTC day. Backstop on top of
// the 12h `nextSyncDueAt` cadence so we never exceed the per-account allowance.
const fetchesToday = new Map<string, { date: string; count: number }>();

function utcDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function budgetRemaining(accountId: string, now: number): number {
  const today = utcDate(now);
  const rec = fetchesToday.get(accountId);
  if (!rec || rec.date !== today) return MAX_SCHEDULED_FETCHES_PER_DAY;
  return Math.max(0, MAX_SCHEDULED_FETCHES_PER_DAY - rec.count);
}

function recordFetch(accountId: string, now: number): void {
  const today = utcDate(now);
  const rec = fetchesToday.get(accountId);
  if (!rec || rec.date !== today) fetchesToday.set(accountId, { date: today, count: 1 });
  else rec.count += 1;
}

async function tick(): Promise<void> {
  if (!isBankFeatureConfigured()) return;
  const now = Date.now();

  let users;
  try {
    users = await getAllUsers();
  } catch (err) {
    console.error('[bank-scheduler] user scan failed:', err);
    return;
  }

  for (const user of users) {
    let connections;
    try {
      connections = await getBankConnections(user.id);
    } catch {
      continue; // one user's read failing must not stop the others
    }

    for (const conn of connections) {
      if (conn.status !== 'active' || !conn.nextSyncDueAt) continue;
      if (new Date(conn.nextSyncDueAt).getTime() > now) continue;

      const accounts = conn.linkedAccounts.filter((l) => !l.isExcluded);
      if (accounts.length === 0) continue;
      // Respect the per-account daily budget (reserve headroom for on-demand).
      if (accounts.some((l) => budgetRemaining(l.id, now) <= 0)) continue;

      try {
        await runSync(user.id, conn.id, 'scheduled', {}, now);
        for (const l of accounts) recordFetch(l.id, now);
      } catch (err) {
        // Per-connection isolation: one failure never breaks the loop.
        console.error('[bank-scheduler] sync failed:', redactBankError(err));
      }
    }
  }
}

/** Start the scheduler once. No-op if already started or feature unconfigured. */
export function startBankScheduler(): void {
  if (started) return;
  if (!isBankFeatureConfigured()) {
    console.log('[bank-scheduler] Enable Banking not configured — scheduler idle');
    return;
  }
  started = true;
  timer = setInterval(() => {
    tick().catch((err) => console.error('[bank-scheduler] tick error:', err));
  }, SCHEDULER_TICK_MS);
  // A short delayed first tick so boot isn't blocked and disk is settled.
  setTimeout(() => {
    tick().catch(() => {});
  }, 15_000);
  console.log('[bank-scheduler] started');
}

export function stopBankScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
