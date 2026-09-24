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

    try {
      const { getDb, getDbPath } = await import('@/lib/db/sqlite/client');
      getDb();
      console.log(`[db] opened encrypted database ${getDbPath()} (migrations applied)`);
      const { importLegacyUsers } = await import('@/lib/db/sqlite/legacy-import');
      const result = await importLegacyUsers();
      if (result.status === 'imported') {
        console.log(`[db] imported ${result.imported} legacy users (${result.softDeleted} soft-deleted) from .enc files`);
      }
      const { startSnapshotScheduler } = await import('@/lib/db/sqlite/snapshot');
      startSnapshotScheduler();
    } catch (error) {
      // Leave the server up so the error is visible in the log; every auth
      // request will fail loudly until the DB/key problem is fixed.
      console.error('[db] startup FAILED (check ENCRYPTION_KEY / DATA_DIR):', error);
    }

    const { startBankScheduler } = await import('@/lib/bank/scheduler');
    startBankScheduler();
  }
}
