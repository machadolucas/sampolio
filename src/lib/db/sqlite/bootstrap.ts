import { discardNewlyCreatedDb, getDb, getDbPath, wasDbCreatedByThisProcess } from './client';
import { verifyUserStore } from './user-store';
import { markSetupFailed } from './setup-state';

export interface BootstrapResult {
  ok: boolean;
  /** The DB is open with the right key and may be snapshotted. */
  dbUsable: boolean;
  dbDiscarded: boolean;
}

/**
 * Boot-time DB setup, run once from src/instrumentation.ts before the server
 * takes requests: open (+ migrate) the SQLCipher DB, then check that it holds
 * the users the data dirs belong to (user-store.ts).
 *
 * Fails CLOSED. On any error the process-wide setup failure is recorded
 * (setup-state.ts): sign-up and session creation are refused, `auth()` returns
 * null and /api/auth answers 503 until the cause is fixed and the app is
 * restarted.
 *
 * If THIS process just created `sampolio.db` and the check then failed (user
 * data dirs exist, so a DB should have been there), the new file is closed and
 * deleted: the usual cause is a wrong ENCRYPTION_KEY or a lost DB, and keeping
 * an empty DB would let a later boot "work" against it. Deleting is safe
 * because nothing else can have written to a file created moments earlier
 * before any request was served; `dbDiscarded` then also blocks `getDb()`
 * from re-creating it in this process. A pre-existing DB is never deleted.
 */
export async function bootstrapDatabase(): Promise<BootstrapResult> {
  let opened = false;
  try {
    getDb();
    opened = true;
    console.log(`[db] opened encrypted database ${getDbPath()} (migrations applied)`);
    const store = verifyUserStore();
    console.log(`[db] user store ok: ${store.users} user(s), ${store.dataDirs} data dir(s)`);
    return { ok: true, dbUsable: true, dbDiscarded: false };
  } catch (error) {
    const dbDiscarded = opened && wasDbCreatedByThisProcess() ? discardNewlyCreatedDb() : false;
    markSetupFailed(error, { dbDiscarded });
    const bar = '='.repeat(78);
    console.error(
      [
        bar,
        '[db] STARTUP FAILED — sign-in and sign-up are DISABLED (fail closed) until this is fixed and the app restarted.',
        `[db] cause: ${error instanceof Error ? error.message : String(error)}`,
        dbDiscarded
          ? `[db] the just-created ${getDbPath()} was removed (wrong ENCRYPTION_KEY or a lost DB); restore snapshots/sampolio.db.`
          : `[db] ${getDbPath()} was left untouched.`,
        '[db] check ENCRYPTION_KEY / DATA_DIR; a lost or wrong DB is restored from snapshots/sampolio.db.',
        bar,
      ].join('\n'),
      error,
    );
    return { ok: false, dbUsable: opened && !dbDiscarded, dbDiscarded };
  }
}
