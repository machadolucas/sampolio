import { lt } from 'drizzle-orm';
import { getDb } from './client';
import { verification } from './schema';

/**
 * Housekeeping for Better Auth's `verification` table.
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

/**
 * Prune now, then hourly. Idempotent per process. Called from
 * `src/instrumentation.ts` just before the snapshot scheduler, so the startup
 * snapshot does not carry dead challenge rows.
 */
export function startMaintenanceScheduler(): void {
  if (globalForMaintenance.__sampolioMaintenanceTimer) return;
  runVerificationPruneLogged('startup');
  const timer = setInterval(() => runVerificationPruneLogged('hourly'), ONE_HOUR);
  timer.unref();
  globalForMaintenance.__sampolioMaintenanceTimer = timer;
}

/** Tests only. */
export function stopMaintenanceScheduler(): void {
  clearInterval(globalForMaintenance.__sampolioMaintenanceTimer);
  globalForMaintenance.__sampolioMaintenanceTimer = undefined;
}
