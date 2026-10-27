// Key rotation: `PRAGMA hexrekey` the SQLCipher DB (<DATA_DIR>/sampolio.db,
// key derived from ENCRYPTION_KEY — see src/lib/db/sqlite/key.ts) from the
// OLD key to the NEW one and rewrite its snapshot under the new key. All app
// data lives in that DB.
//
//   OLD_ENCRYPTION_KEY=<old> ENCRYPTION_KEY=<new> node scripts/rotate-encryption-key.mjs [--dry-run]
//
// Key/dir resolution:
//   OLD_ENCRYPTION_KEY env (required).
//   ENCRYPTION_KEY env, else <DATA_DIR>/.encryption_key file (the NEW key —
//     update the dot-file to the new key BEFORE running, or pass the env var).
//   DATA_DIR env, else ./data.
//
// Safety:
//   - Refuses to run when old and new keys are identical.
//   - STOP THE APP while rotating (the rekey needs exclusive access) and TAKE A
//     BACKUP FIRST. Re-running is safe: a DB that already opens with the new key
//     is reported and left alone (its snapshot is rewritten under the new key).
//   - --dry-run only checks which key opens the DB; it does not rekey.

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { DB_FILE_NAME, deriveSqliteKeyHex, openEncrypted, writeSnapshot } from './sqlcipher-lib.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

async function resolveNewKey(dataDir) {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;
  try {
    const fromFile = (await fs.readFile(path.join(dataDir, '.encryption_key'), 'utf8')).trim();
    if (fromFile) {
      console.warn(`ENCRYPTION_KEY not set; using ${path.join(dataDir, '.encryption_key')} as the NEW key`);
      return fromFile;
    }
  } catch {
    /* fall through */
  }
  console.error('ERROR: ENCRYPTION_KEY (the NEW key) not set and no <DATA_DIR>/.encryption_key file found. Aborting.');
  process.exit(1);
}

async function main() {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const oldKey = process.env.OLD_ENCRYPTION_KEY;
  if (!oldKey) {
    console.error('ERROR: OLD_ENCRYPTION_KEY not set. Aborting.');
    process.exit(1);
  }
  const newKey = await resolveNewKey(dataDir);
  if (oldKey === newKey) {
    console.error('ERROR: OLD_ENCRYPTION_KEY and ENCRYPTION_KEY are identical — nothing to rotate.');
    process.exit(1);
  }

  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Rotating the encryption key of ${path.join(dataDir, DB_FILE_NAME)}`);
  const dbStatus = rotateSqliteDb(dataDir, oldKey, newKey);
  console.log(`  sampolio.db: ${dbStatus}`);
  if (dbStatus.startsWith('FAILED')) process.exitCode = 1;
}

/** Rekey <DATA_DIR>/sampolio.db from the old derived key to the new one and
 * rewrite the snapshot (the old snapshot is only readable with the OLD key). */
function rotateSqliteDb(dataDir, oldKey, newKey) {
  const dbFile = path.join(dataDir, DB_FILE_NAME);
  if (!fsSync.existsSync(dbFile)) return 'absent (nothing to rekey)';
  const oldHex = deriveSqliteKeyHex(oldKey);
  const newHex = deriveSqliteKeyHex(newKey);

  let db;
  try {
    db = openEncrypted(dbFile, oldHex);
  } catch {
    try {
      db = openEncrypted(dbFile, newHex);
    } catch (e) {
      return `FAILED — opens with neither key (${e.message})`;
    }
    try {
      if (!DRY_RUN) writeSnapshot(db, dataDir, newHex);
      return 'already on new key' + (DRY_RUN ? '' : ' (snapshot rewritten)');
    } catch (e) {
      return `FAILED — snapshot: ${e.message}`;
    } finally {
      db.close();
    }
  }

  try {
    if (DRY_RUN) return 'opens with old key (would rekey)';
    // SQLite3MultipleCiphers rekeys in rollback-journal mode; restore WAL after.
    db.pragma('journal_mode = DELETE');
    db.pragma(`hexrekey='${newHex}'`);
    db.pragma('journal_mode = WAL');
    db.close();
    db = openEncrypted(dbFile, newHex);
    const snap = writeSnapshot(db, dataDir, newHex);
    return `rekeyed old → new (snapshot rewritten: ${snap.bytes} bytes)`;
  } catch (e) {
    return `FAILED — ${e.message}`;
  } finally {
    db?.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
