import { lt } from 'drizzle-orm';
import { rateLimitRowRetentionMs } from '@/lib/auth/rate-limit-rules';
import { getDb } from './client';
import { rateLimit, verification } from './schema';

/**
 * Housekeeping for Better Auth's `verification` and `rateLimit` tables.
 *
 * ## verification
 *
 * Every `/passkey/generate-authenticate-options` call (the sign-in page's
 * conditional-UI autofill runs it on each load) and every
 * `/passkey/generate-register-options` call writes a single-use challenge row
 * that expires after 5 minutes. A completed ceremony consumes its row, but an
 * abandoned one (the visitor never picks a passkey) stays forever:
 * `consumeVerificationValue`, the only lookup the passkey plugin uses, does
 * not prune. Better Auth's own cleanup runs only inside
 * `findVerificationValue`, which Sampolio never reaches.
 *
 * Deleting rows whose `expiresAt` has passed is safe for every verification
 * use: Better Auth treats an expired row as invalid (consume returns null)
 * and `findVerificationValue` deletes the same set itself.
 */

/** Delete verification rows that expired before `now`. Returns the count. */
export function pruneExpiredVerifications(now: Date = new Date()): number {
  return getDb().delete(verification).where(lt(verification.expiresAt, now)).run().changes;
}

/*
 * ## rateLimit
 *
 * One row per client IP + path (`storage: 'database'`). Better Auth 1.7.5
 * deletes rows older than its longest window only when some bucket rolls
 * over, so a key that is never hit again (a one-off IP, a probed path) can
 * stay forever. Rows whose `lastRequest` is older than
 * `rateLimitRowRetentionMs()` (2 × the longest configured window, at least
 * 24 h) are dead: the next request to that key starts a fresh window in any
 * case. Live buckets (inside their window) are never touched, so pruning
 * cannot reset a count.
 */

/** Delete rateLimit rows idle for longer than the retention. Returns the count. */
export function pruneStaleRateLimits(now: Date = new Date()): number {
  const cutoff = now.getTime() - rateLimitRowRetentionMs();
  return getDb().delete(rateLimit).where(lt(rateLimit.lastRequest, cutoff)).run().changes;
}

const ONE_HOUR = 60 * 60 * 1000;
const globalForMaintenance = globalThis as typeof globalThis & { __sampolioMaintenanceTimer?: NodeJS.Timeout };

/** Prune and log. Periodic runs stay quiet when there was nothing to delete. */
export function runVerificationPruneLogged(reason: string, now: Date = new Date()): number {
  try {
    const deleted = pruneExpiredVerifications(now);
    if (deleted > 0 || reason === 'startup') {
      console.log(`[db] pruned ${deleted} expired verification row(s) (${reason})`);
    }
    return deleted;
  } catch (error) {
    console.error(`[db] verification prune (${reason}) FAILED:`, error);
    return 0;
  }
}

/** Same for rateLimit rows. */
export function runRateLimitPruneLogged(reason: string, now: Date = new Date()): number {
  try {
    const deleted = pruneStaleRateLimits(now);
    if (deleted > 0 || reason === 'startup') {
      console.log(`[db] pruned ${deleted} stale rate-limit row(s) (${reason})`);
    }
    return deleted;
  } catch (error) {
    console.error(`[db] rate-limit prune (${reason}) FAILED:`, error);
    return 0;
  }
}

/** Every prune, each logged and failing on its own. */
export function runMaintenanceLogged(reason: string, now: Date = new Date()): void {
  runVerificationPruneLogged(reason, now);
  runRateLimitPruneLogged(reason, now);
}

/**
 * Prune now, then hourly. Idempotent per process. Called from
 * `src/instrumentation.ts` just before the snapshot scheduler, so the startup
 * snapshot does not carry dead challenge or rate-limit rows.
 */
export function startMaintenanceScheduler(): void {
  if (globalForMaintenance.__sampolioMaintenanceTimer) return;
  runMaintenanceLogged('startup');
  const timer = setInterval(() => runMaintenanceLogged('hourly'), ONE_HOUR);
  timer.unref();
  globalForMaintenance.__sampolioMaintenanceTimer = timer;
}

/** Tests only. */
export function stopMaintenanceScheduler(): void {
  clearInterval(globalForMaintenance.__sampolioMaintenanceTimer);
  globalForMaintenance.__sampolioMaintenanceTimer = undefined;
}
