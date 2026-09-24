import { discardNewlyCreatedDb, getDb, getDbPath, wasDbCreatedByThisProcess } from './client';
import { importLegacyUsers } from './legacy-import';
import { markSetupFailed } from './setup-state';

export interface BootstrapResult {
  ok: boolean;
  /** The DB is open with the right key and may be snapshotted. */
  dbUsable: boolean;
  dbDiscarded: boolean;
}

/**
 * Boot-time DB setup, run once from src/instrumentation.ts before the server
 * takes requests: open (+ migrate) the SQLCipher DB, then the one-shot legacy
 * `.enc` user import.
 *
 * Fails CLOSED. On any error the process-wide setup failure is recorded
 * (setup-state.ts): sign-up and session creation are refused, `auth()` returns
 * null and /api/auth answers 503 until the cause is fixed and the app is
 * restarted. Nothing half-imported is committed (the import is one
 * transaction and writes its marker last).
 *
 * If THIS process just created `sampolio.db` and the import then failed, the
 * new file is closed and deleted: the usual cause is a wrong ENCRYPTION_KEY
 * (the legacy files do not decrypt), and keeping an empty DB keyed with that
 * wrong key would let a later boot "work" against it. Deleting is safe
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
    const result = await importLegacyUsers();
    if (result.status === 'imported') {
      console.log(`[db] imported ${result.imported} legacy users (${result.softDeleted} soft-deleted) from .enc files`);
    } else {
      console.log('[db] legacy users already imported');
    }
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
          ? `[db] the just-created ${getDbPath()} was removed (likely wrong ENCRYPTION_KEY); it will be recreated on the next boot.`
          : `[db] ${getDbPath()} was left untouched.`,
        '[db] check ENCRYPTION_KEY / DATA_DIR and the legacy users-index.enc + users/*/user.enc files.',
        bar,
      ].join('\n'),
      error,
    );
    return { ok: false, dbUsable: opened && !dbDiscarded, dbDiscarded };
  }
}
