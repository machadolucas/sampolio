# Database Layer (`src/lib/db/`)

Encrypted storage layer. Financial data is individually encrypted JSON files on disk; **users and auth** (Better Auth tables) live in one SQLCipher-encrypted SQLite file, `${DATA_DIR}/sampolio.db` (`sqlite/` below) — the foundation for moving the remaining entities off `.enc` files one module at a time.

## Encryption (`encryption.ts`)

- **Algorithm**: AES-256-GCM
- **Key derivation**: **HKDF-SHA256** per file (a single HMAC, ~microseconds). `ENCRYPTION_KEY` is already a full-entropy 256-bit key, so PBKDF2's password-stretching iterations bought **zero** security while blocking the event loop ~50-150ms per file — and with a unique salt per file the derived-key cache almost never hit, so a cold page load (150-200 files) paid that cost 150-200×. HKDF is the correct KDF for high-entropy input key material; this is not a security regression.
- **Per-file security**: each file gets a random 64-byte salt and 16-byte IV (HKDF derives a distinct per-file key from `ENCRYPTION_KEY` + salt, so identical plaintext still yields distinct ciphertext).
- **Backward-compatible reads**: the file format (`salt + iv + authTag + ciphertext`, base64) is unchanged, so old and new files are byte-identical in shape — only the derivation differs. `decrypt()` tries HKDF first and, on GCM auth failure, falls back to the legacy `pbkdf2Sync(…, 100000, …, 'sha512')` key. GCM authentication makes the key choice unambiguous (forging a tag is infeasible); the wasted HKDF attempt on a legacy file costs microseconds. New writes always use HKDF.
- **Migration** (`scripts/reencrypt-data.mjs`): one-shot walk of `DATA_DIR` that decrypts (compat reader) → re-encrypts (HKDF) → atomic temp+rename per file. Idempotent, never deletes; `--dry-run` reports counts. Reads `ENCRYPTION_KEY` from env or `<DATA_DIR>/.encryption_key`. Run once after deploy (backup first) so every read hits the fast path; correctness does not depend on it (reads stay backward-compatible).
- **Storage format**: Base64-encoded string containing `salt + iv + authTag + ciphertext`
- **Key source**: `ENCRYPTION_KEY` environment variable (64-char hex string). **Missing key is a hard failure in production** (throws on first use); development falls back to a known default with a console warning.
- **Key rotation** (`scripts/rotate-encryption-key.mjs`): decrypts with `OLD_ENCRYPTION_KEY` (HKDF + PBKDF2 fallback), re-encrypts with the new `ENCRYPTION_KEY`; refuses identical keys, `--dry-run` supported, resumable. See `docs/operations.md` §8.
- **Performance**: LRU cache (max 500 entries) retained for the legacy PBKDF2 fallback keys only (HKDF is fast enough to skip caching). See `encryption.test.ts` for round-trip + legacy-compat coverage.

### Core Functions

```typescript
readEncryptedFile<T>(filePath: string): Promise<T>
writeEncryptedFile<T>(filePath: string, data: T): Promise<void>
getDataDir(): string              // ~/.sampolio/data/ or custom
getUserDir(userId: string): string // ~/.sampolio/data/users/{userId}
ensureDir(dir: string): Promise<void>
listFiles(dir: string): Promise<string[]>
deleteFile(filePath: string): Promise<void>
```

## SQLCipher database (`sqlite/`)

| File | Role |
|---|---|
| `sqlite/key.ts` | `getSqliteKeyHex()` = HKDF-SHA256(`ENCRYPTION_KEY`, info `sampolio-sqlite-v1`) → 64-hex raw key. Reuses `getEncryptionKey()` (same production guard). Never change the label. |
| `sqlite/client.ts` | `getDb()` (drizzle) / `getSqlite()` (raw better-sqlite3) — lazy `globalThis` singleton, **never opened at import time** (`next build` evaluates modules). PRAGMA order: `cipher='sqlcipher'`, `legacy=4`, `hexkey`, verify via `SELECT count(*) FROM sqlite_master` (a wrong key only fails here), then WAL / `foreign_keys=ON` / `busy_timeout=5000`, then migrations. `openEncryptedDatabase()` for other files; `closeDb()` for tests. |
| `sqlite/schema/` | Hand-written drizzle tables: `auth.ts` (Better Auth `user`/`session`/`account`/`verification`/`passkey`/`rateLimit` — export and property names are load-bearing for the adapter), `meta.ts` (`_meta` key/value), `index.ts` barrel. |
| `sqlite/migrate.ts` + `/drizzle` | Committed SQL from `pnpm db:generate` (drizzle-kit **generate only** — it cannot open the keyed DB; no push/migrate/studio). Applied by the runtime migrator on first connection; idempotent. |
| `sqlite/snapshot.ts` | `createSnapshot()`: `VACUUM INTO '<plain path>'` (SQLite3MultipleCiphers encrypts the copy with the source key; the `file:…?hexkey=` URI form is unusable because better-sqlite3 does not enable URI filenames), verify (no plaintext header, opens with key, fails without), atomic rename to `snapshots/sampolio.db`. Never `db.backup()` (unkeyed ⇒ plaintext). `startSnapshotScheduler()`: boot + every 6 h + daily 04:55. CLI twin: `scripts/db-snapshot.mjs`. |
| `sqlite/maintenance.ts` | `pruneExpiredVerifications()`: `DELETE FROM verification WHERE expiresAt < now`. Every passkey options request (the sign-in page's conditional UI on each load) writes a 5-minute challenge row; an abandoned ceremony's row is never consumed, and Better Auth only prunes inside `findVerificationValue`, which the passkey plugin does not use. Safe for all verification uses (expired rows are already invalid). `pruneStaleRateLimits()`: `DELETE FROM rateLimit WHERE lastRequest < now - rateLimitRowRetentionMs()` (2 × the longest window in `src/lib/auth/rate-limit-rules.ts`, at least 24 h); Better Auth prunes only when a bucket rolls over, so keys never hit again stayed forever, and a row inside its window is never deleted. `startMaintenanceScheduler()`: both, at boot (before the startup snapshot) + hourly. |
| `sqlite/legacy-import.ts` | One-shot `.enc` → DB user import (see `users.ts` below), guarded by `_meta` `legacy-users-imported`, one transaction; throws `LegacyImportError` on any inconsistency (missing index, unreadable file, missing email, duplicate email, id mismatch). Also `isAuthSetupComplete()` / `isFirstUserSetup()` / `hasLegacyUserData()`. |
| `sqlite/bootstrap.ts` + `setup-state.ts` | Boot sequence (open → import) that **fails closed**: records the failure, deletes a DB file this boot created, and blocks auth (503 `SETUP_INCOMPLETE`). |

Driver: `better-sqlite3` is a **pnpm alias** for `better-sqlite3-multiple-ciphers` (N-API prebuilds, `allowBuilds: false` in `pnpm-workspace.yaml`), so drizzle's `drizzle-orm/better-sqlite3` gets the cipher build. It is in `serverExternalPackages`.

**`users.ts` / `passkeys.ts`** are the first DB-backed modules: `users.ts` keeps its file-era exports (`findUserByEmail`, `findUserById`, `getAllUsers`, `createUser`, `updateUser`, `changePassword`, `deleteUser`, `hardDeleteUser`, `setUserAvatar`, `toPublicUser`, `avatarUrlFor`, lockout helpers) over drizzle queries. `getAllUsers`/`findUserByEmail` exclude soft-deleted users (as the old index did); `findUserById` does not. Soft delete = `deletedAt` + `isActive=false` + tombstone email `deleted+<id>@invalid` + sessions deleted; hard delete = `DELETE user` (FK cascade: sessions, accounts, passkeys) + `rm -rf` of the user dir. Deactivation and admin password reset revoke sessions but keep passkeys. `passkeys.ts` lists/counts/removes passkeys (labels via the plugin's AAGUID map) and stamps `lastUsedAt` (`recordPasskeySignIn`, by credential id **and** user, called from the verify-authentication after-hook once a session exists).

### Moving another entity to SQLite (the pattern)

1. Add its tables to `sqlite/schema/<entity>.ts` (export from `index.ts`), run `pnpm db:generate`, read the SQL (additive only), commit `drizzle/`.
2. Re-implement the entity's `src/lib/db/<entity>.ts` **behind its existing function signatures** (same inputs/outputs, ISO-string dates at the boundary, `uuid` v4 ids), so actions and `cached.ts` do not change. `cached.ts` stays on top with the same tags.
3. Add a one-shot importer next to `legacy-import.ts` with its own `_meta` guard, reading the `.enc` files with `readEncryptedFile` and writing in one transaction; leave the `.enc` files in place until a later cleanup.
4. Tests on a temp encrypted DB (`src/test/temp-data-dir.ts`), including importer idempotency.

## Data Directory Structure

```
{dataDir}/
├── sampolio.db (+ -wal/-shm) # SQLCipher: Better Auth tables + _meta (see above)
├── snapshots/sampolio.db     # verified encrypted snapshot (what backups archive)
├── users-index.enc           # LEGACY { users: [{ id, email }] } — imported once, never written
├── app-settings.enc          # { selfSignupEnabled, updatedAt, updatedBy }
├── shared/                   # Shared (non-user-scoped) entities — access control in the action layer
│   ├── mortgages/{id}.enc    # SharedMortgage (loans + members embedded)
│   ├── mortgages/{id}/       # rates/ costs/ extra-payments/ snapshots/ (+ embedded actuals)
│   ├── mortgage-members/{userId}.enc   # Reverse index: userId → mortgageIds
│   ├── split-groups/{id}.enc           # SplitGroup (members + recurrence rules embedded)
│   ├── split-groups/{id}/expenses/{YYYY-MM}.enc  # Monthly chunk: array of that month's expenses/payments
│   ├── split-groups/{id}/summary.enc   # Maintained running balances (netByUserId) + month index
│   └── split-group-members/{userId}.enc  # Reverse index: userId → groupIds
└── users/{userId}/
    ├── user.enc              # LEGACY profile + bcrypt hash — imported once, kept for rollback, never written
    ├── preferences.enc       # Onboarding, categories, tax defaults
    ├── avatar.webp           # Profile picture — PLAIN binary (NOT encrypted); optional; excluded from JSON backup
    ├── accounts/{id}.enc     # One file per cash account
    ├── accounts/{id}/        # Per-account sub-entities, one file each
    │   ├── recurring/{itemId}.enc
    │   ├── planned/{itemId}.enc
    │   ├── salary/{configId}.enc
    │   └── taxed-income/{incomeId}.enc
    ├── investments/{id}.enc  (+ investments/{id}/contributions/{cid}.enc)
    ├── debts/{id}.enc        (+ debts/{id}/reference-rates/ + extra-payments/)
    ├── receivables/{id}.enc  (+ receivables/{id}/repayments/)
    ├── budgets/{id}.enc      # One doc per budget (lines, funding, expenses embedded)
    ├── goals/{id}.enc        # Financial goals (UI at /goals)
    ├── trips/{id}.enc        # Trips / per diem (UI on the merged /budgets page)
    ├── bank/                 # Enable Banking sync (read-only) — bank-connections.ts / bank-transactions.ts / bank-sync-runs.ts
    │   ├── connections/{connectionId}.enc               # BankConnection (linkedAccounts[] embedded)
    │   ├── accounts/{linkedAccountId}/transactions.enc  # Imported transaction ledger (one file per linked bank account)
    │   └── sync-runs/{id}.enc                           # Sync-run audit log
    └── reconciliation/       # Three AGGREGATE files (arrays), not one file per row
        ├── balance-snapshots.enc
        ├── reconciliation-adjustments.enc
        └── reconciliation-sessions.enc
```

> Most entities are **user-scoped** (`users/{userId}/…`). The exceptions are the **shared mortgage** and the **split groups** (`split-groups.ts`), which live under `shared/` because they are co-owned by multiple members; the encryption key is global, so member access control is enforced in the action layer (`loadMortgageForMember` / `loadGroupForMember`), not by the filesystem.
>
> **Split-group storage is monthly-chunked, not one-file-per-row**: at ~2,500 expenses/group, one file per row would mean thousands of separate decrypts (and, pre-HKDF, thousands of PBKDF2 runs) on every cache miss. Even with fast HKDF derivation, chunking keeps file counts and I/O bounded. Each `{YYYY-MM}.enc` holds a month's array, and a `summary.enc` (delta-maintained on add, rebuilt on edit/delete/import) holds running balances so the hot paths never decrypt full history. The per-group in-process mutex lives in the action layer.
>
> **Avatars are the one unencrypted file** (`users/{id}/avatar.webp`, 256×256 WebP). `users.ts` owns them: `setUserAvatar(userId, Buffer | null)` writes/removes the file and bumps `user.avatarVersion` (DB column); `getAvatarPath(userId)` resolves the path (used by the `/api/avatars/[userId]` route); `avatarUrlFor(user)` / `toPublicUser(user)` produce the versioned URL (`?v={avatarVersion}` cache-buster). Deliberately plaintext — it's low-sensitivity and this enables zero-decrypt streaming + immutable HTTP caching — and deliberately outside the JSON backup (`data-transfer.ts` never touches it).

## DB File Pattern

Each entity type has its own file in this directory. They all follow the same pattern:

```typescript
// List all entities
export async function getItems(userId: string): Promise<Item[]> {
  const dir = path.join(getUserDir(userId), 'items');
  await ensureDir(dir);
  const files = await listFiles(dir);
  const encFiles = files.filter(f => f.endsWith('.enc'));
  return Promise.all(encFiles.map(f => readEncryptedFile<Item>(path.join(dir, f))));
}

// Get single entity
export async function getItemById(userId: string, itemId: string): Promise<Item | null> {
  const filePath = path.join(getUserDir(userId), 'items', `${itemId}.enc`);
  try { return await readEncryptedFile<Item>(filePath); }
  catch { return null; }
}

// Create entity
export async function createItem(userId: string, data: CreateItemRequest): Promise<Item> {
  const item: Item = { id: uuidv4(), ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const filePath = path.join(getUserDir(userId), 'items', `${item.id}.enc`);
  await ensureDir(path.dirname(filePath));
  await writeEncryptedFile(filePath, item);
  return item;
}

// Update entity (read-modify-write)
export async function updateItem(userId: string, itemId: string, updates: Partial<Item>): Promise<Item> {
  const existing = await getItemById(userId, itemId);
  if (!existing) throw new Error('Not found');
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  await writeEncryptedFile(path.join(getUserDir(userId), 'items', `${itemId}.enc`), updated);
  return updated;
}

// Delete entity
export async function deleteItem(userId: string, itemId: string): Promise<void> {
  await deleteFile(path.join(getUserDir(userId), 'items', `${itemId}.enc`));
}
```

## Cached Queries (`cached.ts`)

Wraps DB read functions with Next.js `cacheLife('indefinite')` and `cacheTag()`:

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

- **No file locking**: Concurrent read-modify-write operations on `.enc` files can cause data loss. Acceptable for single-user scenarios.
- **No transactions for `.enc` files**: Operations are not atomic — a crash mid-write could corrupt a file. The SQLite side (users/auth) is transactional (WAL).
