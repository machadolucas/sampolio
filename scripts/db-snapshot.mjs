// Manual / deploy-time encrypted snapshot of the SQLCipher DB.
//
//   node scripts/db-snapshot.mjs            (or: pnpm db:snapshot)
//
// Writes <DATA_DIR>/snapshots/sampolio.db via VACUUM INTO (still encrypted
// with the same derived key), verifies it (not plaintext, opens with the key,
// fails without it) and only then atomically replaces the previous snapshot.
// Safe while the app is running (WAL: VACUUM INTO is a read transaction).
// The app also snapshots on boot, every 6 h and daily at 04:55.
//
// Key/dir resolution: ENCRYPTION_KEY env, else <DATA_DIR>/.encryption_key;
// DATA_DIR env, else ./data. Never creates or migrates the DB.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DB_FILE_NAME, deriveSqliteKeyHex, openEncrypted, resolveEncryptionKey, writeSnapshot } from './sqlcipher-lib.mjs';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const dbFile = path.join(dataDir, DB_FILE_NAME);

if (!fs.existsSync(dbFile)) {
  console.error(`ERROR: ${dbFile} does not exist (start the app once to create it).`);
  process.exit(1);
}
const encryptionKey = resolveEncryptionKey(dataDir);
if (!encryptionKey) {
  console.error('ERROR: ENCRYPTION_KEY not set and no <DATA_DIR>/.encryption_key file found.');
  process.exit(1);
}

const keyHex = deriveSqliteKeyHex(encryptionKey);
let db;
try {
  db = openEncrypted(dbFile, keyHex);
  db.pragma('busy_timeout = 5000');
  const { path: out, bytes } = writeSnapshot(db, dataDir, keyHex);
  console.log(`Snapshot written: ${out} (${bytes} bytes, encrypted, verified)`);
} catch (e) {
  console.error(`ERROR: snapshot failed — ${e.message}`);
  process.exitCode = 1;
} finally {
  db?.close();
}
