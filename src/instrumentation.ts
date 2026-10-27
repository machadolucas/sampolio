/**
 * Next.js instrumentation hook — runs once when the server process boots
 * (Node runtime only). Order matters:
 *  1. open the SQLCipher DB + apply migrations (src/lib/db/sqlite/),
 *  2. check that the DB holds the users the data dirs belong to and is a 6.x
 *     finance store (fails closed),
 *  3. prune expired `verification` rows (abandoned WebAuthn challenges) now
 *     and hourly, then an encrypted snapshot now, every 6 h and daily at 04:55,
 *  4. the Enable Banking background sync scheduler — only after a clean
 *     bootstrap, so it never writes into a wrong or pre-6.0 store.
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
      // Expired WebAuthn challenges first, so the startup snapshot omits them.
      const { startMaintenanceScheduler } = await import('@/lib/db/sqlite/maintenance');
      startMaintenanceScheduler();
      const { startSnapshotScheduler } = await import('@/lib/db/sqlite/snapshot');
      startSnapshotScheduler();
    }

    // The bank scheduler writes financial rows; skip it unless bootstrap passed.
    if (result.ok) {
      const { startBankScheduler } = await import('@/lib/bank/scheduler');
      startBankScheduler();
    }
  }
}
