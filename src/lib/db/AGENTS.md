# Database Layer (`src/lib/db/`)

Encrypted storage layer. **All data** lives in one SQLCipher-encrypted SQLite file, `${DATA_DIR}/sampolio.db` (`sqlite/` below): the Better Auth tables (users, sessions, passkeys) and the finance tables (`sqlite/schema/finance.ts`), which hold every financial entity as a JSON document row. The file-era `*.enc` tree is still on disk but is **read only once**, by the boot-time importer (`sqlite/file-import.ts`); nothing else reads or writes it. Avatars are the one plain file (below).

## Encryption (`encryption.ts`)

`encryption.ts` now serves the file-era `.enc` tree (read by `sqlite/file-import.ts` and the maintenance scripts), the id/path guards, `getDataDir`/`getUserDir`, and `getEncryptionKey()` (from which `sqlite/key.ts` derives the SQLCipher key). The `.enc` format:

- **Algorithm**: AES-256-GCM
- **Key derivation**: **HKDF-SHA256** per file (a single HMAC, ~microseconds). `ENCRYPTION_KEY` is already a full-entropy 256-bit key, so PBKDF2's password-stretching iterations bought **zero** security while blocking the event loop ~50-150ms per file — and with a unique salt per file the derived-key cache almost never hit, so a cold page load (150-200 files) paid that cost 150-200×. HKDF is the correct KDF for high-entropy input key material; this is not a security regression.
- **Per-file security**: each file gets a random 64-byte salt and 16-byte IV (HKDF derives a distinct per-file key from `ENCRYPTION_KEY` + salt, so identical plaintext still yields distinct ciphertext).
- **Backward-compatible reads**: the file format (`salt + iv + authTag + ciphertext`, base64) is unchanged, so old and new files are byte-identical in shape — only the derivation differs. `decrypt()` tries HKDF first and, on GCM auth failure, falls back to the legacy `pbkdf2Sync(…, 100000, …, 'sha512')` key. GCM authentication makes the key choice unambiguous (forging a tag is infeasible); the wasted HKDF attempt on a legacy file costs microseconds. New writes always use HKDF.
- **Migration** (`scripts/reencrypt-data.mjs`): one-shot walk of `DATA_DIR` that decrypts (compat reader) → re-encrypts (HKDF) → atomic temp+rename per file. Idempotent, never deletes; `--dry-run` reports counts. Reads `ENCRYPTION_KEY` from env or `<DATA_DIR>/.encryption_key`. Run once after deploy (backup first) so every read hits the fast path; correctness does not depend on it (reads stay backward-compatible).
- **Storage format**: Base64-encoded string containing `salt + iv + authTag + ciphertext`; the plaintext is **compact** JSON (`JSON.stringify` without indentation — older pretty-printed files still read, since parsing is whitespace-agnostic)
- **Key source**: `ENCRYPTION_KEY` environment variable (64-char hex string). **Missing key is a hard failure in production** (throws on first use); development falls back to a known default with a console warning.
- **Key rotation** (`scripts/rotate-encryption-key.mjs`): decrypts with `OLD_ENCRYPTION_KEY` (HKDF + PBKDF2 fallback), re-encrypts with the new `ENCRYPTION_KEY`; refuses identical keys, `--dry-run` supported, resumable. See `docs/operations.md` §8.
- **Performance**: LRU cache (max 500 entries) retained for the legacy PBKDF2 fallback keys only (HKDF is fast enough to skip caching). See `encryption.test.ts` for round-trip + legacy-compat coverage.

### Core Functions

```typescript
readEncryptedFile<T>(filePath: string): Promise<T | null>   // null on ENOENT
writeEncryptedFile<T>(filePath: string, data: T): Promise<void>
getDataDir(): string              // $DATA_DIR or <cwd>/data
getUserDir(userId: string): string // {dataDir}/users/{userId} — userId passes assertSafeId
entityPath(dir: string, id: string, suffix = '.enc'): string // {dir}/{id}{suffix}, id validated
entityDir(dir: string, id: string): string                   // {dir}/{id}, id validated
assertSafeId(id: unknown, label?: string): string            // [A-Za-z0-9_-]{1,64} else UnsafePathError
assertChunkMonth(yearMonth: unknown, label?: string): string // YYYY-MM shape (split chunk names)
assertInsideDataDir(targetPath: string, opts?): string       // resolved path must stay inside DATA_DIR
ensureDir(dir: string): Promise<void>
listFiles(dir: string): Promise<string[]>
deleteFile(filePath: string): Promise<void>
fileExists(filePath: string): Promise<boolean>
```

### Id guards

Ids reach this layer straight from action arguments and import payloads. Every DB module still passes each id through `assertSafeId` (and split months through `assertChunkMonth`) before it becomes a row key, so a malformed id throws `UnsafePathError` exactly as it did when ids were path segments; `getUserDir` (avatars) and the file primitives above keep the path checks (`assertInsideDataDir`). Actions validate the same patterns first (`idSchema` / `yearMonthSchema` / `chunkMonthSchema` in `src/lib/schemas/id.schema.ts`, `isSafeId` in `src/lib/safe-id.ts`) so callers normally see a clean validation error. Tests: `path-guard.test.ts`.

## SQLCipher database (`sqlite/`)

| File | Role |
|---|---|
| `sqlite/key.ts` | `getSqliteKeyHex()` = HKDF-SHA256(`ENCRYPTION_KEY`, info `sampolio-sqlite-v1`) → 64-hex raw key. Reuses `getEncryptionKey()` (same production guard). Never change the label. |
| `sqlite/client.ts` | `getDb()` (drizzle) / `getSqlite()` (raw better-sqlite3) — lazy `globalThis` singleton, **never opened at import time** (`next build` evaluates modules). PRAGMA order: `cipher='sqlcipher'`, `legacy=4`, `hexkey`, verify via `SELECT count(*) FROM sqlite_master` (a wrong key only fails here), then WAL / `foreign_keys=ON` / `busy_timeout=5000`, then migrations. `openEncryptedDatabase()` for other files; `closeDb()` for tests. |
| `sqlite/schema/` | Hand-written drizzle tables: `auth.ts` (Better Auth `user`/`session`/`account`/`verification`/`passkey`/`rateLimit` — export and property names are load-bearing for the adapter), `finance.ts` (the finance document tables, `USER_SCOPED_TABLES`, `FINANCE_TABLES`; map below), `meta.ts` (`_meta` key/value), `index.ts` barrel. |
| `sqlite/docs.ts` | Synchronous document-row helpers over better-sqlite3: `getDoc`, `listDocs`/`listRows` (PK order, or `'seq'`/`'seq-desc'`), `putDoc` (upsert by PK), `insertDoc` (plain INSERT, collision throws), `deleteRows`, `countRows`, `nextSeq`, `distinctValues`, `replaceSeqDocs` (rewrite an ordered list), `inTx` (one transaction; nested = savepoint). Column names are checked against the table; values are bound. |
| `sqlite/file-import.ts` | `importFileData()`: the one-shot `.enc` → SQLite import, run by `bootstrap.ts` before any scheduler. Guarded by `_meta` `file-data-imported` (JSON counts). Every `*.enc` under `DATA_DIR` must map to a known layout path (only the pre-4.0 `users-index.enc` / `users/*/user.enc` are skipped; dot-files, `snapshots/` and non-`.enc` files are ignored) or it aborts listing the unclaimed files; one row per file, one row per element (`seq` = index) for aggregate/chunk files; plain INSERTs; every row is read back and compared with its source and per-table counts are checked inside the same transaction as the marker, so any failure rolls back. Refuses to run when finance rows exist without the marker **and** `.enc` files are present (a fresh install with seeded rows and no files just records the marker). Never modifies or deletes `.enc` files. |
| `sqlite/migrate.ts` + `/drizzle` | Committed SQL from `pnpm db:generate` (drizzle-kit **generate only** — it cannot open the keyed DB; no push/migrate/studio). Applied by the runtime migrator on first connection; idempotent. |
| `sqlite/snapshot.ts` | `createSnapshot()`: `VACUUM INTO '<plain path>'` (SQLite3MultipleCiphers encrypts the copy with the source key; the `file:…?hexkey=` URI form is unusable because better-sqlite3 does not enable URI filenames), verify (no plaintext header, opens with key, fails without), atomic rename to `snapshots/sampolio.db`. Never `db.backup()` (unkeyed ⇒ plaintext). `startSnapshotScheduler()`: boot + every 6 h + daily 04:55. CLI twin: `scripts/db-snapshot.mjs`. |
| `sqlite/maintenance.ts` | `pruneExpiredVerifications()`: `DELETE FROM verification WHERE expiresAt < now`. Every passkey options request (the sign-in page's conditional UI on each load) writes a 5-minute challenge row; an abandoned ceremony's row is never consumed, and Better Auth only prunes inside `findVerificationValue`, which the passkey plugin does not use. Safe for all verification uses (expired rows are already invalid). `pruneStaleRateLimits()`: `DELETE FROM rateLimit WHERE lastRequest < now - rateLimitRowRetentionMs()` (2 × the longest window in `src/lib/auth/rate-limit-rules.ts`, at least 24 h); Better Auth prunes only when a bucket rolls over, so keys never hit again stayed forever, and a row inside its window is never deleted. `startMaintenanceScheduler()`: both, at boot (before the startup snapshot) + hourly. |
| `sqlite/user-store.ts` | Consistency gate between the `user` table and the `users/<id>/` data dirs: `verifyUserStore()` (boot; throws `UserStoreError` when data dirs exist but the DB has no user rows — a lost/wrong DB), `isAuthSetupComplete()` / `isFirstUserSetup()` (sign-up and session gates), `countUserDataDirs()` (missing `users/` = 0, other read errors propagate), `tombstoneEmail()`. |
| `sqlite/bootstrap.ts` + `setup-state.ts` | Boot sequence (open → user-store check → `importFileData()`) that **fails closed**: records the failure, deletes a DB file this boot created, and blocks auth (503 `SETUP_INCOMPLETE`). `BootstrapResult.dataReady` is true only when the import completed; `src/instrumentation.ts` starts the bank scheduler only then. |

Driver: `better-sqlite3` is a **pnpm alias** for `better-sqlite3-multiple-ciphers` (N-API prebuilds, `allowBuilds: false` in `pnpm-workspace.yaml`), so drizzle's `drizzle-orm/better-sqlite3` gets the cipher build. It is in `serverExternalPackages`.

**`users.ts` / `passkeys.ts`** wrap the auth tables: `users.ts` keeps its file-era exports (`findUserByEmail`, `findUserById`, `getAllUsers`, `createUser`, `updateUser`, `changePassword`, `deleteUser`, `hardDeleteUser`, `setUserAvatar`, `toPublicUser`, `avatarUrlFor`, lockout helpers) over drizzle queries. `getAllUsers`/`findUserByEmail` exclude soft-deleted users (as the old index did); `findUserById` does not. Soft delete = `deletedAt` + `isActive=false` + tombstone email `deleted+<id>@invalid` + sessions deleted (finance rows kept); hard delete = one transaction deleting every `USER_SCOPED_TABLES` row for the user (`deleteAllUserData`, `user-data.ts`) and the `user` row (FK cascade: sessions, accounts, passkeys), then `rm -rf` of the user dir (avatar, legacy `.enc` files). Deactivation and admin password reset revoke sessions but keep passkeys. `passkeys.ts` lists/counts/removes passkeys (labels via the plugin's AAGUID map) and stamps `lastUsedAt` (`recordPasskeySignIn`, by credential id **and** user, called from the verify-authentication after-hook once a session exists).

### Finance tables (`sqlite/schema/finance.ts`)

Each row stores one entity's exact JSON in `data` (what the `.enc` file held), so every field round-trips; the other columns are lookup keys only and **sorting stays in the modules** (JS comparators, as before). Identity mirrors the former file paths; former aggregate/chunk files are one row per element with `seq` keeping the array order. There are **no foreign keys** between these tables or to `user`: deleting a parent never cascaded on disk (an account's items outlive it), so cascades are explicit in the modules, inside one transaction.

| Table | Key | Former file | Module |
|---|---|---|---|
| `user_preferences` | `userId` | `users/{u}/preferences.enc` | `user-preferences.ts` |
| `fin_account` | `userId, id` | `accounts/{id}.enc` | `accounts.ts` |
| `recurring_item` / `planned_item` / `salary_config` / `taxed_income` | `userId, accountId, id` | `accounts/{a}/{recurring,planned,salary,taxed-income}/{id}.enc` | `recurring-items.ts` … `taxed-income.ts` |
| `investment` + `investment_contribution` | `userId, id` / `userId, investmentId, id` | `investments/…` | `investments.ts` |
| `debt` + `debt_reference_rate` / `debt_extra_payment` | `userId, id` / `userId, debtId, id` | `debts/…` | `debts.ts` |
| `receivable` + `receivable_repayment` | `userId, id` / `userId, receivableId, id` | `receivables/…` | `receivables.ts` |
| `budget` / `goal` / `trip` | `userId, id` | `{budgets,goals,trips}/{id}.enc` (whole doc, arrays embedded) | `budgets.ts` / `goals.ts` / `trips.ts` |
| `balance_snapshot` / `reconciliation_adjustment` / `reconciliation_session` | `userId, id` + `seq` | elements of the three `reconciliation/*.enc` aggregates | `reconciliation.ts` |
| `bank_connection` / `bank_session_secret` | `userId, id` / `userId, connectionId` | `bank/connections/{id}.enc` / `{id}.session.enc` | `bank-connections.ts` |
| `bank_transaction` | `userId, linkedAccountId, seq` (no unique `dedupKey`: identical `#occN` rows are legitimate) | elements of `bank/accounts/{l}/transactions.enc` | `bank-transactions.ts` |
| `bank_sync_run` | `userId, connectionId, seq` (0 = newest, capped at 50) | elements of `bank/sync-runs/{c}.enc` | `bank-sync-runs.ts` |
| `app_settings` | `id = 'app'` | `app-settings.enc` | `app-settings.ts` |
| `mortgage` + `mortgage_{rate,cost,extra_payment,balance_snapshot,actual}` | `id` / `mortgageId, id` | `shared/mortgages/…` | `shared-mortgages.ts` |
| `mortgage_member_index` / `split_group_member_index` | `userId, mortgageId` / `userId, groupId` + `seq` (key-only rows) | `shared/{mortgage,split-group}-members/{u}.enc` | `shared-mortgages.ts` / `split-groups.ts` |
| `split_group` / `split_group_summary` | `id` / `groupId` | `shared/split-groups/{id}.enc` / `{id}/summary.enc` | `split-groups.ts` |
| `split_expense` | `groupId, id` + `yearMonth` (storage month) + `seq` (position in that month) | elements of `shared/split-groups/{g}/expenses/{YYYY-MM}.enc` | `split-groups.ts` |

`user-data.ts` groups the user-scoped tables the way the old sub-directories were (`USER_DATA_GROUPS`: `accounts` includes every account's items, `bank` all four bank tables, …); backup replace mode (`data-transfer.ts`) and "Start fresh" (`resetMyData`) delete by group, hard delete removes them all.

### Adding an entity table (the pattern)

1. Add the table to `sqlite/schema/finance.ts` (`userId` + keys + `data`, `seq` if order matters; add it to `USER_SCOPED_TABLES` / `FINANCE_TABLES` and, if user-owned, a `USER_DATA_GROUPS` group), run `pnpm db:generate --name <change>`, read the SQL (additive only), commit `drizzle/`. drizzle-kit only generates — it cannot open the keyed DB.
2. Write `src/lib/db/<entity>.ts` with `sqlite/docs.ts` helpers, `uuid` v4 ids, ISO-string dates, `assertSafeId` on every id, and every read-modify-write inside `inTx`. `cached.ts` wraps the reads with the entity's tags.
3. Tests on a temp encrypted DB (`useTempDataDir` from `src/test/temp-data-dir.ts`).

## Data Directory Structure

```
{dataDir}/
├── sampolio.db (+ -wal/-shm) # SQLCipher: auth tables + finance tables + _meta (see above)
├── snapshots/sampolio.db     # verified encrypted snapshot (what backups archive)
├── users/{userId}/
│   └── avatar.webp           # Profile picture — PLAIN binary (NOT encrypted); optional; excluded from JSON backup
└── (legacy, read once)       # app-settings.enc, users/{u}/**.enc, shared/**.enc — the file-era tree that
                              # file-import.ts imported; kept as a rollback/backup source, never written
```

> Most entities are **user-scoped** (a `userId` key column). The exceptions are the **shared mortgage** and the **split groups** (`split-groups.ts`), whose tables have no `userId` because they are co-owned by multiple members; member access control is enforced in the action layer (`loadMortgageForMember` / `loadGroupForMember`), with the per-user reverse indexes mapping members to ids.
>
> **Split-group expenses** are one `split_expense` row each, keyed by group and id, with the storage month (`yearMonth`, the former chunk) and `seq` (position within that month); `getExpenseMonths` is `SELECT DISTINCT yearMonth`, and `locateExpense` is an indexed lookup that returns the row's month (`LocatedExpense { ym, rows, index }`, `rows` = that month in `seq` order). A `split_group_summary` row holds running balances so the hot paths never read full history. The summary is **delta-maintained** on add, edit and delete (`applySummaryDelta`: subtract the old row, add the new one, no other month read) and **rebuilt** (`rebuildSummary`) only for bulk import, occurrence pruning, an occurrence overwrite on a catch-up re-run, a missing summary, or a delete of the row that set `lastActivityAt`; rows and summary commit in one transaction. `upsertExpenseByOccurrence(groupId, row, { onePerMonth })` skips a new occurrence when the month already holds a row from the same rule for the same recurrence period (the month in `occurrenceKey`, `occurrencePeriod`) and reports `{ created, skipped }`. The per-group in-process mutex is `withGroupLock` in `src/lib/split-group-lock.ts`; callers hold it around these writes (it spans the action's read-then-write, which one DB transaction does not).
>
> **Balance snapshots** (`reconciliation.ts`): `createBalanceSnapshot(userId, entityType, entityId, yearMonth, expected, actual, source = 'manual', bankProvenance?)` upserts per entity/month (last write wins). `bankProvenance` sets the optional `balanceType` / `balanceAsOf` / `monthStartBalance` fields on a bank-sync snapshot; a write without it drops them. Semantics: `docs/projections-and-reconciliation.md` §3/§9.
>
> **Backup export** (`data-transfer.ts`): `readUserDataForExport` reads every exported entity straight from the DB (no `'use cache'`), trips included; `writeUserDataFromExport` writes in one transaction, preserves ids/timestamps, rewrites only `userId`, never touches bank data, merges the reconciliation lists by id (`mergeById`, order kept), and in replace mode deletes the exported groups plus `trips` only when the payload carries a `trips` array (v2).
>
> **Avatars are the one unencrypted file** (`users/{id}/avatar.webp`, 256×256 WebP). `users.ts` owns them: `setUserAvatar(userId, Buffer | null)` writes/removes the file and bumps `user.avatarVersion` (DB column); `getAvatarPath(userId)` resolves the path (used by the `/api/avatars/[userId]` route); `avatarUrlFor(user)` / `toPublicUser(user)` produce the versioned URL (`?v={avatarVersion}` cache-buster). Deliberately plaintext — it's low-sensitivity and this enables zero-decrypt streaming + immutable HTTP caching — and deliberately outside the JSON backup (`data-transfer.ts` never touches it).

## DB Module Pattern

```typescript
const key = (userId: string, itemId: string) => ({ userId: assertSafeId(userId, 'userId'), id: assertSafeId(itemId) });

export async function getItems(userId: string): Promise<Item[]> {
  return listDocs<Item>(itemTable, { userId: assertSafeId(userId, 'userId') }).sort(byName);
}

export async function getItemById(userId: string, itemId: string): Promise<Item | null> {
  return getDoc<Item>(itemTable, key(userId, itemId)); // null when missing
}

export async function createItem(userId: string, data: CreateItemRequest): Promise<Item> {
  const item: Item = { id: uuidv4(), ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  putDoc(itemTable, key(userId, item.id), item);
  return item;
}

// Read-modify-write: one synchronous transaction, so nothing interleaves.
export async function updateItem(userId: string, itemId: string, updates: Partial<Item>): Promise<Item | null> {
  return inTx(() => {
    const existing = getDoc<Item>(itemTable, key(userId, itemId));
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    putDoc(itemTable, key(userId, itemId), updated);
    return updated;
  });
}

export async function deleteItem(userId: string, itemId: string): Promise<void> {
  deleteRows(itemTable, key(userId, itemId));
}
```

## Cached Queries (`cached.ts`)

Wraps DB read functions with Next.js `cacheLife` and `cacheTag()` — `'indefinite'` for data only request-scoped actions mutate, `'synced'` for anything the background bank scheduler writes (bank connections/ledgers/runs and **every** balance-snapshot read, incl. the batch `cachedGetLatestSnapshotsByEntity`; see `docs/architecture.md` §8):

```typescript
export async function cachedGetAccounts(userId: string) {
  'use cache';
  cacheLife('indefinite');
  cacheTag(`user:${userId}:accounts`);
  return getAccounts(userId);
}
```

After mutations, server actions call `updateTag(tagName)` to invalidate.

## Known Limitations

- **One process, one connection**: writes are transactional (WAL) and a read-modify-write inside `inTx` cannot interleave with other requests in this process. A second process writing the same DB (none today; the CLI scripts only snapshot or rekey with the app stopped) is serialized by SQLite's lock (`busy_timeout=5000`) but not coordinated with in-flight action logic.
- **Action-level races remain where an action reads, awaits, then writes** across several module calls; the split-group mutex covers that for Split, other entities rely on single-user use.
- **Legacy `.enc` tree**: still on disk after the import and no longer updated, so it goes stale; restoring from it means re-running the import on an emptied DB (`docs/operations.md`).
