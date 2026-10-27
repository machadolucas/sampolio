# Database Layer (`src/lib/db/`)

Encrypted storage layer. **All data** lives in one SQLCipher-encrypted SQLite file, `${DATA_DIR}/sampolio.db` (`sqlite/` below): the Better Auth tables (users, sessions, passkeys) and the finance tables (`sqlite/schema/finance.ts`), which hold every financial entity as a JSON document row. Avatars are the one plain file (below).

## Key, data dir and id guards (`encryption.ts`)

```typescript
getEncryptionKey(): string        // ENCRYPTION_KEY; hard failure in production when unset, dev default + warning otherwise
getDataDir(): string              // $DATA_DIR or <cwd>/data
getUserDir(userId: string): string // {dataDir}/users/{userId} — userId passes assertSafeId (avatars)
assertSafeId(id: unknown, label?: string): string            // [A-Za-z0-9_-]{1,64} else UnsafePathError
assertChunkMonth(yearMonth: unknown, label?: string): string // YYYY-MM shape (split storage months)
assertInsideDataDir(targetPath: string, opts?): string       // resolved path must stay inside DATA_DIR
ensureDir(dir: string): Promise<void>
```

`ENCRYPTION_KEY` is the app's one secret (64-char hex); `sqlite/key.ts` derives the SQLCipher key from it, and key rotation is `scripts/rotate-encryption-key.mjs` (`docs/operations.md` §8). Ids reach this layer straight from action arguments and import payloads: every DB module passes each id through `assertSafeId` (split months through `assertChunkMonth`) before it becomes a row key, so a malformed id throws `UnsafePathError`; `getUserDir`/`ensureDir` keep the path checks. Actions validate the same patterns first (`idSchema` / `yearMonthSchema` / `chunkMonthSchema` in `src/lib/schemas/id.schema.ts`, `isSafeId` in `src/lib/safe-id.ts`) so callers normally see a clean validation error. Tests: `path-guard.test.ts`, `encryption.test.ts`.

## SQLCipher database (`sqlite/`)

| File | Role |
|---|---|
| `sqlite/key.ts` | `getSqliteKeyHex()` = HKDF-SHA256(`ENCRYPTION_KEY`, info `sampolio-sqlite-v1`) → 64-hex raw key. Reuses `getEncryptionKey()` (same production guard). Never change the label. |
| `sqlite/client.ts` | `getDb()` (drizzle) / `getSqlite()` (raw better-sqlite3) — lazy `globalThis` singleton, **never opened at import time** (`next build` evaluates modules). PRAGMA order: `cipher='sqlcipher'`, `legacy=4`, `hexkey`, verify via `SELECT count(*) FROM sqlite_master` (a wrong key only fails here), then WAL / `foreign_keys=ON` / `busy_timeout=5000`, then migrations. `openEncryptedDatabase()` for other files; `closeDb()` for tests. |
| `sqlite/schema/` | Hand-written drizzle tables: `auth.ts` (Better Auth `user`/`session`/`account`/`verification`/`passkey`/`rateLimit` — export and property names are load-bearing for the adapter), `finance.ts` (the finance document tables, `USER_SCOPED_TABLES`, `FINANCE_TABLES`; map below), `meta.ts` (`_meta` key/value), `index.ts` barrel. |
| `sqlite/docs.ts` | Synchronous document-row helpers over better-sqlite3: `getDoc`, `listDocs`/`listRows` (PK order, or `'seq'`/`'seq-desc'`), `putDoc` (upsert by PK), `insertDoc` (plain INSERT, collision throws), `deleteRows`, `countRows`, `nextSeq`, `distinctValues`, `replaceSeqDocs` (rewrite an ordered list), `inTx` (one transaction; nested = savepoint). Column names are checked against the table; values are bound. |
| `sqlite/migrate.ts` + `/drizzle` | Committed SQL from `pnpm db:generate` (drizzle-kit **generate only** — it cannot open the keyed DB; no push/migrate/studio). Applied by the runtime migrator on first connection; idempotent. |
| `sqlite/snapshot.ts` | `createSnapshot()`: `VACUUM INTO '<plain path>'` (SQLite3MultipleCiphers encrypts the copy with the source key; the `file:…?hexkey=` URI form is unusable because better-sqlite3 does not enable URI filenames), verify (no plaintext header, opens with key, fails without), atomic rename to `snapshots/sampolio.db`. Never `db.backup()` (unkeyed ⇒ plaintext). `startSnapshotScheduler()`: boot + every 6 h + daily 04:55. CLI twin: `scripts/db-snapshot.mjs`. |
| `sqlite/maintenance.ts` | `pruneExpiredVerifications()`: `DELETE FROM verification WHERE expiresAt < now`. Every passkey options request (the sign-in page's conditional UI on each load) writes a 5-minute challenge row; an abandoned ceremony's row is never consumed, and Better Auth only prunes inside `findVerificationValue`, which the passkey plugin does not use. Safe for all verification uses (expired rows are already invalid). `pruneStaleRateLimits()`: `DELETE FROM rateLimit WHERE lastRequest < now - rateLimitRowRetentionMs()` (2 × the longest window in `src/lib/auth/rate-limit-rules.ts`, at least 24 h); Better Auth prunes only when a bucket rolls over, so keys never hit again stayed forever, and a row inside its window is never deleted. `startMaintenanceScheduler()`: both, at boot (before the startup snapshot) + hourly. |
| `sqlite/user-store.ts` | Consistency gate between the `user` table and the `users/<id>/` data dirs: `verifyUserStore()` (boot; throws `UserStoreError` when data dirs exist but the DB has no user rows — a lost/wrong DB), `isAuthSetupComplete()` / `isFirstUserSetup()` (sign-up and session gates), `countUserDataDirs()` (missing `users/` = 0, other read errors propagate), `tombstoneEmail()`. `verifyFinanceStore()` (boot): passes when the `_meta` finance-store marker `file-data-imported` exists; records it on a fresh install or when finance rows exist; throws `UserStoreError` for users with no finance rows and no marker — a pre-6.0 database whose data was in files nothing reads any more. |
| `sqlite/bootstrap.ts` + `setup-state.ts` | Boot sequence (open → `verifyUserStore()` → `verifyFinanceStore()`) that **fails closed**: records the failure, deletes a DB file this boot created, and blocks auth (503 `SETUP_INCOMPLETE`); `src/instrumentation.ts` starts the bank scheduler only when it returned `ok`. |

Driver: `better-sqlite3` is a **pnpm alias** for `better-sqlite3-multiple-ciphers` (N-API prebuilds, `allowBuilds: false` in `pnpm-workspace.yaml`), so drizzle's `drizzle-orm/better-sqlite3` gets the cipher build. It is in `serverExternalPackages`.

**`users.ts` / `passkeys.ts`** wrap the auth tables: `users.ts` exports (`findUserByEmail`, `findUserById`, `getAllUsers`, `createUser`, `updateUser`, `changePassword`, `deleteUser`, `hardDeleteUser`, `setUserAvatar`, `toPublicUser`, `avatarUrlFor`, lockout helpers) over drizzle queries. `getAllUsers`/`findUserByEmail` exclude soft-deleted users (as the old index did); `findUserById` does not. Soft delete = `deletedAt` + `isActive=false` + tombstone email `deleted+<id>@invalid` + sessions deleted (finance rows kept); hard delete = one transaction deleting every `USER_SCOPED_TABLES` row for the user (`deleteAllUserData`, `user-data.ts`) and the `user` row (FK cascade: sessions, accounts, passkeys), then `rm -rf` of the user dir (avatar). Deactivation and admin password reset revoke sessions but keep passkeys. `passkeys.ts` lists/counts/removes passkeys (labels via the plugin's AAGUID map) and stamps `lastUsedAt` (`recordPasskeySignIn`, by credential id **and** user, called from the verify-authentication after-hook once a session exists).

### Finance tables (`sqlite/schema/finance.ts`)

Each row stores one entity's exact JSON in `data`, so every field round-trips; the other columns are lookup keys only and **sorting stays in the modules** (JS comparators). Ordered lists are one row per element with `seq` keeping the order. There are **no foreign keys** between these tables or to `user`: deleting an account leaves its items (it never cascaded), so cascades are explicit in the modules, inside one transaction.

| Table | Key | Holds | Module |
|---|---|---|---|
| `user_preferences` | `userId` | `UserPreferences` | `user-preferences.ts` |
| `fin_account` | `userId, id` | `FinancialAccount` | `accounts.ts` |
| `recurring_item` / `planned_item` / `salary_config` / `taxed_income` | `userId, accountId, id` | items per account | `recurring-items.ts` … `taxed-income.ts` |
| `investment` + `investment_contribution` | `userId, id` / `userId, investmentId, id` | `InvestmentAccount` / `InvestmentContribution` | `investments.ts` |
| `debt` + `debt_reference_rate` / `debt_extra_payment` | `userId, id` / `userId, debtId, id` | `Debt` / `DebtReferenceRate`, `DebtExtraPayment` | `debts.ts` |
| `receivable` + `receivable_repayment` | `userId, id` / `userId, receivableId, id` | `Receivable` / `ReceivableRepayment` | `receivables.ts` |
| `budget` / `goal` / `trip` | `userId, id` | whole doc, arrays embedded | `budgets.ts` / `goals.ts` / `trips.ts` |
| `balance_snapshot` / `reconciliation_adjustment` / `reconciliation_session` | `userId, id` + `seq` | ordered per user | `reconciliation.ts` |
| `bank_connection` / `bank_session_secret` | `userId, id` / `userId, connectionId` | `BankConnection` (links embedded) / `BankSessionSecret` (never cached) | `bank-connections.ts` |
| `bank_transaction` | `userId, linkedAccountId, seq` (no unique `dedupKey`: identical `#occN` rows are legitimate) | one linked account's ordered ledger | `bank-transactions.ts` |
| `bank_sync_run` | `userId, connectionId, seq` (0 = newest, capped at 50) | `BankSyncRun` | `bank-sync-runs.ts` |
| `app_settings` | `id = 'app'` | `AppSettings` | `app-settings.ts` |
| `mortgage` + `mortgage_{rate,cost,extra_payment,balance_snapshot,actual}` | `id` / `mortgageId, id` | `SharedMortgage` (loans + members embedded) / its schedules | `shared-mortgages.ts` |
| `mortgage_member_index` / `split_group_member_index` | `userId, mortgageId` / `userId, groupId` + `seq` (key-only rows) | reverse indexes userId → ids | `shared-mortgages.ts` / `split-groups.ts` |
| `split_group` / `split_group_summary` | `id` / `groupId` | `SplitGroup` (members + rules embedded) / `SplitGroupSummary` | `split-groups.ts` |
| `split_expense` | `groupId, id` + `yearMonth` (storage month) + `seq` (position in that month) | `SplitExpense` | `split-groups.ts` |

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
└── users/{userId}/
    └── avatar.webp           # Profile picture — PLAIN binary (NOT encrypted); optional; excluded from JSON backup
```

> Most entities are **user-scoped** (a `userId` key column). The exceptions are the **shared mortgage** and the **split groups** (`split-groups.ts`), whose tables have no `userId` because they are co-owned by multiple members; member access control is enforced in the action layer (`loadMortgageForMember` / `loadGroupForMember`), with the per-user reverse indexes mapping members to ids.
>
> **Split-group expenses** are one `split_expense` row each, keyed by group and id, with the storage month (`yearMonth`) and `seq` (position within that month); `getExpenseMonths` is `SELECT DISTINCT yearMonth`, and `locateExpense` is an indexed lookup that returns the row's month (`LocatedExpense { ym, rows, index }`, `rows` = that month in `seq` order). A `split_group_summary` row holds running balances so the hot paths never read full history. The summary is **delta-maintained** on add, edit and delete (`applySummaryDelta`: subtract the old row, add the new one, no other month read) and **rebuilt** (`rebuildSummary`) only for bulk import, occurrence pruning, an occurrence overwrite on a catch-up re-run, a missing summary, or a delete of the row that set `lastActivityAt`; rows and summary commit in one transaction. `upsertExpenseByOccurrence(groupId, row, { onePerMonth })` skips a new occurrence when the month already holds a row from the same rule for the same recurrence period (the month in `occurrenceKey`, `occurrencePeriod`) and reports `{ created, skipped }`. The per-group in-process mutex is `withGroupLock` in `src/lib/split-group-lock.ts`; callers hold it around these writes (it spans the action's read-then-write, which one DB transaction does not).
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
