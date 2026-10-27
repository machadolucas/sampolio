/**
 * Next.js instrumentation hook — runs once when the server process boots
 * (Node runtime only). Order matters:
 *  1. open the SQLCipher DB + apply migrations (src/lib/db/sqlite/),
 *  2. check that the DB holds the users the data dirs belong to, then import
 *     the file-era `.enc` financial data once (verified, fails closed),
 *  3. prune expired `verification` rows (abandoned WebAuthn challenges) now
 *     and hourly, then an encrypted snapshot now, every 6 h and daily at 04:55,
 *  4. the Enable Banking background sync scheduler — only once the financial
 *     data is in the DB, so it never writes into a half-migrated store.
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

    // The bank scheduler writes financial rows; skip it unless bootstrap (incl.
    // the file import) completed.
    if (result.dataReady) {
      const { startBankScheduler } = await import('@/lib/bank/scheduler');
      startBankScheduler();
    }
  }
}
