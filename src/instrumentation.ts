/**
 * Next.js instrumentation hook — runs once when the server process boots
 * (Node runtime only). Order matters:
 *  1. open the SQLCipher DB + apply migrations (src/lib/db/sqlite/),
 *  2. one-shot import of the legacy `.enc` users (guarded by a _meta row),
 *  3. encrypted snapshot now, then every 6 h and daily at 04:55,
 *  4. the Enable Banking background sync scheduler (reads the users table).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installTimestampedConsole } = await import('@/lib/server-logger');
    installTimestampedConsole();

    // Fails closed: on error auth is disabled (see bootstrap.ts), but the
    // encrypted snapshot still runs whenever the DB itself opened correctly.
    const { bootstrapDatabase } = await import('@/lib/db/sqlite/bootstrap');
    const result = await bootstrapDatabase();
    if (result.dbUsable) {
      const { startSnapshotScheduler } = await import('@/lib/db/sqlite/snapshot');
      startSnapshotScheduler();
    }

    // The bank scheduler reads the users table; skip it when the DB is unusable.
    if (result.dbUsable) {
      const { startBankScheduler } = await import('@/lib/bank/scheduler');
      startBankScheduler();
    }
  }
}
