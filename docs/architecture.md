# Sampolio — System Architecture

Current-state reference for developers (human and AI) extending the app or hunting bugs.
Conventions and invariants live in the root [`AGENTS.md`](../AGENTS.md); deep feature
mechanics live in [`features.md`](features.md), [`projections-and-reconciliation.md`](projections-and-reconciliation.md),
[`mortgage.md`](mortgage.md), [`bank-sync.md`](bank-sync.md), and [`operations.md`](operations.md).

## 1. Stack

| Layer | Package | Version (package.json) |
|---|---|---|
| Framework | `next` | 16.4.3 (App Router, `cacheComponents: true`) |
| UI runtime | `react` / `react-dom` | 19.3.1 |
| Language | `typescript` | ^6.0.3 (strict) |
| Components | App-owned shadcn/Base UI source | `@base-ui/react` 1.9.0; `@tanstack/react-table` 9.3.1; `@daypicker/react` 10.0.2; Lucide 1.61.0 |
| Styling | `tailwindcss` | ^4.3.3 (via `@tailwindcss/postcss`) |
| Auth | `better-auth` + `@better-auth/passkey` | 1.7.12 exact (scrypt hashes; `bcryptjs` ^3.0.3 only verifies legacy imported hashes) |
| Auth DB | `drizzle-orm` 0.45.4 + `better-sqlite3` → `npm:better-sqlite3-multiple-ciphers@13.0.3` | SQLCipher-encrypted SQLite (`drizzle-kit` 0.31.11 generates migrations only) |
| Validation | `zod` | ^4.6.7 |
| Forms | `react-hook-form` ^7.91.0 + `@hookform/resolvers` ^6.0.0 |
| Charts | `echarts` ^6.1.0 (+ `echarts-for-react` ^3.0.6), `chart.js` ^4.6.1 with `react-chartjs-2` 5.3.1 |
| Avatar crop | `react-easy-crop` | ^6.2.4 (lazy-loaded in the avatar editor) |
| Dates | `date-fns` | ^4.4.0 |
| JWT (bank API) | `jose` | ^6.2.13 (RS256 for Enable Banking) |
| IDs | `uuid` | ^14.0.3 |
| Tests | `vitest` 5.0.5, `@testing-library/react` ^16.3.3, `jsdom` ^30.1.3 |

Package manager: **pnpm 12.15.0** (`packageManager` field). Node: **>= 26** (`engines`; `.nvmrc` = `v26`).
Persistence is one SQLCipher-encrypted SQLite file (`${DATA_DIR}/sampolio.db`) holding the
auth tables and every financial entity as a JSON document row (§6, §9). No external
database server.

Compatibility bounds: ESLint 9 and TypeScript 6 remain within the lint plugins' supported peer ranges. Better Auth and passkey are exactly paired at 1.7.12; dependency installation retains pnpm's minimum-release-age safeguard. SQLCipher alias and native-module externalization remain unchanged.

## 2. Runtime topology

A single Node process (`next start`) serves everything: pages, server actions, the API
routes (Better Auth, the bank consent callback, and the avatar image endpoint), and an
in-process background bank-sync scheduler. Production runs as the launchd
service `com.sampolio.app` on port **3999** against `~/.sampolio/data`, built into `.next-prod`
(`NEXT_DIST_DIR`); the dev preview runs `next dev -p 4999` against a repo-local `./data` copy
and the default `.next` dir, so the two never share a build. External access goes through a
cloudflared tunnel gated by Cloudflare Access. Full topology, secrets layout, and deploy
runbook: [`operations.md`](operations.md).

## 3. Route map

| Route | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Home dashboard (bank-account glance strip + projected-month tile, merged split balances+activity card; add via the sidebar/mobile toolbar quick action). Server component: `auth()` + `redirect('/auth/signin')`; wraps `AppLayout` itself (outside the route group). |
| `/overview` | `src/app/(dashboard)/overview/page.tsx` | Wealth dashboard (net worth, KPIs, reminders). |
| `/cashflow` | `src/app/(dashboard)/cashflow/page.tsx` | Monthly cash-flow projection + retrospective. |
| `/mortgage` | `src/app/(dashboard)/mortgage/page.tsx` | Shared-mortgage ledger, charts, reconcile/import. |
| `/budgets`, `/budgets/[id]` | `src/app/(dashboard)/budgets/…` | Merged "Trips & Budgets" page (stacked Trips + Budgets sections) + budget detail editor. |
| `/split`, `/split/[id]` | `src/app/(dashboard)/split/…` | Split groups list + group ledger (Splitwise replacement). |
| `/goals` | `src/app/(dashboard)/goals/page.tsx` | Financial goals: card grid with progress vs. projections, create/edit dialog. |
| `/trips` | `src/app/(dashboard)/trips/page.tsx` | Server `redirect('/budgets')` — trips live on the merged Trips & Budgets page. |
| `/bank` | `src/app/(dashboard)/bank/page.tsx` | Connected bank accounts + imported transaction ledger. |
| `/playground` | `src/app/(dashboard)/playground/page.tsx` | Ephemeral "What If?" scenario explorer. |
| `/settings` | `src/app/(dashboard)/settings/page.tsx` | Preferences, banking, JSON export/import, admin panel, data maintenance, account self-service (password change, start fresh, delete account) (TabView; deep-link `?tab=banking`). |
| `/auth/signin`, `/auth/signup` | `src/app/auth/…` | Password + passkey sign-in (button and conditional-UI autofill) / sign-up (pass-through `auth/layout.tsx`). |
| `/auth/error` | `src/app/auth/error/page.tsx` | Better Auth redirect-error target (`onAPIError.errorURL`); fixed messages only. |
| `/dev-login` | `src/app/dev-login/route.ts` | GET handler: dev-only password-less sign-in as `DEV_AUTH_BYPASS`; returns 404 in production, when the flag is unset, or for a non-loopback request (§9). |
| `/api/auth/[...all]` | `src/app/api/auth/[...all]/route.ts` | Better Auth HTTP handler (`getAuth().handler`). |
| `/api/bank/callback` | `src/app/api/bank/callback/route.ts` | Enable Banking consent callback (one of two non-auth API routes). |
| `/api/avatars/[userId]` | `src/app/api/avatars/[userId]/route.ts` | User avatar image (session-gated; serves the plain-binary `avatar.webp`; `Cache-Control: private, max-age=31536000, immutable` with a `?v={avatarVersion}` buster). Node runtime. |
| `/manifest.webmanifest` | `src/app/manifest.ts` | Static PWA manifest. |

**Auth guarding is layered:**

- `src/proxy.ts` redirects cookie-less requests to `/auth/signin` for `/` and every app-page
  prefix in its `PROTECTED_PREFIXES` list (`/overview`, `/cashflow`, `/mortgage`, `/budgets`,
  `/trips`, `/split`, `/bank`, `/goals`, `/playground`, `/settings`) — a lightweight cookie-presence
  check (Node.js runtime, no DB access for app pages); add new pages to that list.
- `/` guards itself server-side (`auth()` + `redirect`).
- The `(dashboard)` group layout (`src/app/(dashboard)/layout.tsx`) validates the session
  server-side (`auth()` + `redirect('/auth/signin')`) before wrapping children in
  `AppLayout`, so page shells never render unauthenticated even if the proxy check is
  bypassed. Independently, **every server action verifies `auth()`** — data is guarded
  regardless of either layer. The group also has a `template.tsx` that re-mounts per
  navigation and wraps children in `PageEntrance` (250ms `rise-in`, restarted on pathname
  change — see §17 Motion); `/` wraps itself the same way in
  `home-dashboard.tsx`.

## 4. Request flow

```
client page ('use client')
  → server action (src/lib/actions/*)      'use server'; auth() → Zod safeParse → op → updateTag
    → cached query (src/lib/db/cached.ts)  'use cache' + cacheTag + cacheLife
      → db module (src/lib/db/*)           read-modify-write in one transaction (sqlite/docs.ts inTx)
        → finance tables                   JSON document rows (sqlite/schema/finance.ts)
          → ${DATA_DIR}/sampolio.db       SQLCipher
```

Every action returns `ApiResponse<T> = { success: boolean; data?: T; error?: string }`
(`src/types/index.ts`). There are **no REST endpoints** besides the Better Auth handler and the
bank consent callback — all reads and mutations are server actions invoked from client
components. Next runs client-invoked server actions one at a time, so the heaviest pages
(Overview, Home, Goals) load through one page-level aggregate read each
(`src/lib/actions/dashboard-data.ts`) that fans out in parallel on the server.

## 5. Server-action inventory (`src/lib/actions/`)

| Module | Exported actions |
|---|---|
| `account.ts` | `changeMyPassword` (Better Auth `changePassword`, revokes other sessions), `listMyPasskeys`, `getAccountDeletionPreflight`, `deleteMyAccount`, `resetMyData`, `updateMyAvatar` (self-service; Settings → Account) |
| `accounts.ts` | `getAccounts`, `getAccountById`, `createAccount`, `updateAccount`, `deleteAccount` |
| `admin.ts` | `getUsers` (rows carry `passkeyCount`), `getUserById`, `createUser`, `updateUser` (incl. optional `avatarDataUri`; deactivation and password reset revoke sessions, keep passkeys), `deleteUser` (soft delete), `listUserPasskeys`, `removeUserPasskeys`, `getSettings`, `updateSettings`, `revalidateAllCaches` |
| `app-info.ts` | `getAppVersion` |
| `auth.ts` | `signUp` (`auth.api.signUpEmail`; signs the user in), `checkSignupEnabled` |
| `bank.ts` | `getBankFeatureStatus`, `getBankConnections`, `listBankAspsps`, `startBankConnection`, `reconnectBankConnection`, `refreshBankConnection`, `disconnectBankConnection`, `updateBankAccountLink`, `getBankConnectionsNeedingAttention`, `getCardLiabilities`, `getHomeBankGlance`, `getCreditCardOptions`, `getCardStatementBreakdownForAccount`, `getBankSyncRuns`, `getBankTransactionsForLink`, `getBankConnection` |
| `dashboard-data.ts` | `getOverviewData`, `getHomeData`, `getGoalsPageData` — page-level aggregate **reads** (auth once, Zod-validated empty args, parallel server-side fan-out over cached readers, one `ApiResponse`; no cache tags of their own) — see [`src/lib/actions/AGENTS.md`](../src/lib/actions/AGENTS.md) |
| `budgets.ts` | `getBudgets`, `getBudgetById`, `createBudget`, `updateBudget`, `deleteBudget`, `confirmBudget`, `unconfirmBudget`, `addBudgetLine`, `updateBudgetLine`, `deleteBudgetLine`, `addBudgetFundingSource`, `updateBudgetFundingSource`, `deleteBudgetFundingSource`, `addBudgetExpenseEntry`, `updateBudgetExpenseEntry`, `deleteBudgetExpenseEntry` |
| `debts.ts` | `getDebts`, `getDebtById`, `createDebt`, `updateDebt`, `deleteDebt`, `getReferenceRates`, `setReferenceRate`, `deleteReferenceRate`, `getExtraPayments`, `createExtraPayment`, `deleteExtraPayment` |
| `data-transfer.ts` | `exportUserData`, `importUserData` (Settings JSON backup, `EXPORT_VERSION` 2 incl. trips; merge/replace — details in the settings `AGENTS.md`) |
| `euribor.ts` | `fetchCurrentEuribor12m` (ECB Data Portal fetch, in-memory TTL cache, graceful failure; prefills the mortgage rate-update dialog) |
| `goals.ts` | `getGoals`, `getGoalById`, `createGoal`, `updateGoal`, `deleteGoal` |
| `investments.ts` | `getInvestmentAccounts`, `getInvestmentAccountById`, `createInvestmentAccount`, `updateInvestmentAccount`, `deleteInvestmentAccount`, `getContributions`, `createContribution`, `updateContribution`, `deleteContribution` |
| `maintenance.ts` | `previewHistoryCompaction`, `compactHistory` |
| `planned.ts` | `getPlannedItems`, `getPlannedItemById`, `createPlannedItem`, `updatePlannedItem`, `deletePlannedItem`, `upsertRecurringItemOccurrenceOverride`, `deleteRecurringItemOccurrenceOverride`, `cleanupExpiredOverrides` |
| `projection.ts` | `getProjection` (Zod-validated id + filters; logic in `computeAccountProjection`, `src/lib/account-projection.ts`) |
| `receivables.ts` | `getReceivables`, `getReceivableById`, `createReceivable`, `updateReceivable`, `deleteReceivable`, `getRepayments`, `createRepayment`, `deleteRepayment` |
| `reconciliation.ts` | `getBalanceSnapshots`, `getSnapshotsForEntity`, `getSnapshotsForMonth`, `getLatestSnapshot`, `createBalanceSnapshot`, `deleteBalanceSnapshot`, `getAdjustmentsForSnapshot`, `createAdjustment`, `deleteAdjustment`, `getReconciliationSessions`, `getSessionForMonth`, `getLatestCompletedSession`, `startReconciliationSession`, `completeReconciliationSession`, `updateSessionSnapshots`, `getReconciliationSummary`, `applyReconciliationBalances` |
| `recurring.ts` | `getRecurringItems`, `getRecurringItemById`, `createRecurringItem`, `updateRecurringItem`, `deleteRecurringItem` |
| `salary.ts` | `getSalaryConfigs`, `getSalaryConfigById`, `createSalaryConfig`, `updateSalaryConfig`, `deleteSalaryConfig` |
| `scenario.ts` | `runScenarioProjection` |
| `shared-mortgages.ts` | `getMyMortgages`, `getMortgage`, `getMortgageProjectionInputs`, `getMyMortgageEquity`, `createMortgage`, `updateMortgage`, `updateMortgageLoan`, `deleteMortgage`, `addMortgageMemberByEmail`, `removeMortgageMember`, `updateMortgageMember`, `setMyMortgageLinkedAccount`, `setMortgageRate`, `deleteMortgageRate`, `setMortgageCost`, `deleteMortgageCost`, `addMortgageExtraPayment`, `deleteMortgageExtraPayment`, `recordMortgageBalanceSnapshot`, `deleteMortgageBalanceSnapshot`, `getMortgageActuals`, `importMortgageActuals`, `clearMortgageActuals`, `reconcileMortgageMonth`, `revertMortgageMonth` |
| `split-groups.ts` | `getMySplitGroups`, `getSplitGroupView`, `getSplitExpenses`, `getSplitActivity`, `getSplitInsights`, `getMySplitNetBalance`, `getMySplitLinkCandidates`, `getSettleUpSuggestions`, `createSplitGroup`, `updateSplitGroup`, `deleteSplitGroup`, `addSplitGroupMember`, `removeSplitGroupMember`, `leaveSplitGroup`, `updateSplitGroupMemberRole`, `setDefaultSplitGroup`, `createSplitExpense`, `quickAddSplitExpense`, `confirmSplitBankLink`, `updateSplitExpense`, `deleteSplitExpense`, `recordSettleUp`, `createSplitRecurrenceRule`, `updateSplitRecurrenceRule`, `deleteSplitRecurrenceRule`, `catchUpGroupRecurrences`, `importSplitwiseCsv`, `markSplitGroupSeen` — every mutating action additionally calls `notifySplitActivity` (`src/lib/split-notify.ts`) after its write + cache invalidation, which schedules a Home Assistant webhook POST for after the response (§11) |
| `taxed-income.ts` | `getTaxedIncomes`, `getTaxedIncomeById`, `createTaxedIncome`, `updateTaxedIncome`, `deleteTaxedIncome` |
| `trips.ts` | `getTrips`, `getTripById`, `createTrip`, `updateTrip`, `deleteTrip` |
| `user-preferences.ts` | `getUserPreferences`, `completeOnboarding`, `updateCategories`, `updateCheckInReminders`, `updateCheckInNotifications`, `updateSplitNotificationPrefs` (five-key opt-out record for the split webhook events), `getSplitNotifyStatus` (is `HA_WEBHOOK_URL` configured), `updateBankAccountOrder`, `updateSplitGroupOrder`, `updateBottomNavIds` (mobile bottom-nav tabs; `null` resets to the per-display-mode defaults), `updateDisplayMode`, `updateTaxDefaults` |
| `user-profiles.ts` | `getUserProfiles` — `{ id, name, avatarUrl? }` for any authenticated user (no email/role; safe for cross-user member displays) |

Tax & contribution defaults (`UserPreferences.taxDefaults`) are **per-user** preferences
(not app settings) and are consumed only as **form prefill** for new salary
configurations (salary modal + onboarding) — each `SalaryConfig` stores its own
immutable copy of the rates, so changing the defaults never touches existing salaries
or other users.

**No barrel exports**: there is no `src/lib/actions/index.ts` — always import from the
concrete module path (e.g. `import { getBankConnections } from '@/lib/actions/bank'`).

## 6. DB layer & on-disk storage

Each entity has a module in `src/lib/db/` (no barrel — import the concrete module) that reads
and writes JSON document rows in the SQLCipher DB through `src/lib/db/sqlite/docs.ts`. The
table map (each table, its keys and the file it replaced), the module pattern and the limits
live in [`src/lib/db/AGENTS.md`](../src/lib/db/AGENTS.md). `src/lib/db/users.ts` and
`passkeys.ts` wrap the Better Auth tables.
Root is `getDataDir()` = `$DATA_DIR` or `<cwd>/data`:

```
data/
├── .encryption_key  .auth_secret  .auth_url    # secrets as dot-files; injected as env by launch config / prod plist
├── sampolio.db (+ -wal, -shm)                  # SQLCipher DB: auth + finance tables + _meta (db/sqlite/); never tar'd live
├── snapshots/sampolio.db                       # verified encrypted VACUUM INTO copy — what backups archive
├── users/{userId}/avatar.webp                  # profile picture — PLAIN binary (unencrypted, deliberate); excluded from JSON backup
                                                #   ↑ low-sensitivity, enables zero-decrypt streaming + HTTP caching
```

One row per entity; ordered lists (reconciliation snapshots/adjustments/sessions, bank
ledgers, sync runs, split expenses within a month, member indexes) are one row per element
with a `seq` column keeping the order. Every module
read-modify-write runs in one synchronous transaction (`inTx`), so it cannot interleave with
another request in this process. Split groups additionally get a per-group in-process mutex
(`withGroupLock` in `src/lib/split-group-lock.ts`, on `globalThis` so every server-action bundle
shares one lock per group; used by the split actions and `deleteMyAccount`) because their actions
read, await and then write; everything else relies on the single-user assumption.

**Id guards** (`src/lib/db/encryption.ts`, patterns in `src/lib/safe-id.ts`): every id that
becomes a row key passes `assertSafeId` (`[A-Za-z0-9_-]{1,64}`) and split months pass
`assertChunkMonth`, throwing `UnsafePathError`; `getUserDir` (avatars) and `ensureDir` also
check `assertInsideDataDir`. The action boundary validates the same patterns
with `idSchema` / `yearMonthSchema` / `chunkMonthSchema` (`src/lib/schemas/id.schema.ts`), and
the shared-entity loaders (`loadGroupForMember`, `loadMortgageForMember`, `loadOwnBudget`) reject
an unsafe id up front (`isSafeId`).

## 7. Encryption

All data is encrypted at rest by SQLCipher (below); `ENCRYPTION_KEY` is the one secret.
`getEncryptionKey()` (`src/lib/db/encryption.ts`) **throws in production** when it is unset
(refusing to start); outside production it logs a warning and falls back to a hardcoded default
key (`'sampolio-default-encryption-key-change-in-prod'`) as a dev convenience. Avatars are the
only plaintext files (§6).

**SQLCipher DB** (`src/lib/db/sqlite/`): `sampolio.db` is encrypted with a raw 256-bit
key = HKDF-SHA256(`ENCRYPTION_KEY`, info `sampolio-sqlite-v1`) (`key.ts`; mirrored by
`scripts/sqlcipher-lib.mjs`). `client.ts` opens it lazily (never at import time — `next build`
evaluates modules) as a `globalThis` singleton; the PRAGMAs `cipher='sqlcipher'`,
`legacy=4`, `hexkey` come first and the key is verified by reading `sqlite_master` (a wrong
key only fails there), then `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, then
the committed `drizzle/` migrations run (`migrate.ts`). `snapshot.ts` writes
`snapshots/sampolio.db` with `VACUUM INTO '<plain path>'` — SQLite3MultipleCiphers encrypts
the target with the source connection's key (the `file:…?hexkey=` URI form does not work:
better-sqlite3 does not enable URI filenames) — and verifies every copy (not a plaintext
header, opens with the key, fails without) before an atomic rename. Never `db.backup()`:
its destination connection is unkeyed, so the copy would be plaintext. At boot,
`bootstrap.ts` runs the user-store and finance-store checks (`user-store.ts`); any failure
fails closed and keeps the bank scheduler off.

## 8. Caching

All cached reads live in `src/lib/db/cached.ts` (`cachedGet*` wrappers using the Next.js 16
`'use cache'` directive + `cacheTag` + `cacheLife`). Two profiles, defined in `next.config.ts`:

| Profile | stale / revalidate / expire | Used for |
|---|---|---|
| `indefinite` | 1y / 1y / 1y | Everything mutated only via request-scoped server actions — invalidated purely by `updateTag`. |
| `synced` | 60s / 300s / 3600s | Data the **background bank scheduler** writes outside request scope: `cachedGetBankConnections`, `cachedGetBankConnectionById`, `cachedGetBankTransactions`, `cachedGetBankSyncRuns`, `cachedGetLatestBankSyncRun`, and every balance-snapshot read (bank-sync anchor snapshots): `cachedGetBalanceSnapshots`, `cachedGetSnapshotsForEntity`, `cachedGetSnapshotsForMonth`, `cachedGetLatestSnapshot`, `cachedGetLatestSnapshotsByEntity`. |

Outside server actions, invalidate through `invalidateTags` (`src/lib/cache-tags.ts`): it
uses `updateTag` in a server action and falls back to `revalidateTag(tag, { expire: 0 })` in a
route handler (the bank OAuth callback). With no request scope at all (the background
scheduler) both throw, so `safeUpdateTags` in `src/lib/bank/sync.ts` ends up a no-op there —
the `synced` profile's short revalidate window is what makes those reads eventually
consistent. Never give background-mutated data `indefinite`.

Every wrapper tags `all-data` plus a specific tag; mutations call `updateTag`. Tag families:

- `user:{userId}` (umbrella), `user:{userId}:accounts`, `user:{userId}:account:{accountId}:recurring|planned|salary|taxed-income`
- `user:{userId}:investments`, `:investment:{id}:contributions`, `:debts`, `:debt:{id}:rates|payments`, `:receivables`, `:receivable:{id}:repayments`
- `user:{userId}:goals`, `:trips`, `:budgets`, `:preferences`, `:reconciliation`
- `user:{userId}:bank-connections`, `:bank-connection:{connectionId}`, `:bank-connection:{connectionId}:runs`, `:bank-account:{linkedAccountId}:transactions`
- `user:{userId}:mortgages` (membership), `mortgage:{id}` + `:rates|costs|payments|snapshots|actuals` (member-agnostic)
- `user:{userId}:split-groups` (membership), `split-group:{id}` + `:summary`, `:expenses` (whole-history readers), `:expenses:{YYYY-MM}` (one month chunk), `:expense-chunks` (every per-month entry — bulk import/prune/delete)
- `users`, `app-settings`, `all-data` (admin "revalidate all")

Batch wrappers (`cachedGetAccountProjectionData`, `cachedGetWealthData`, the mortgage-inputs
batch, `cachedGetLatestSnapshotsByEntity` — latest snapshot per `"{entityType}:{entityId}"`
from one read) fetch a page's whole dataset in one cached call with the union of tags. Child
mutations (investment contributions, debt reference rates and extra payments) also invalidate
their parent collection tag (`user:{userId}:investments` / `:debts`), because the batch wrappers
embed child rows.

## 9. Auth

**Better Auth 1.7.12** (`src/lib/auth/server.ts`, lazy `getAuth()` singleton on `globalThis`)
on the SQLCipher DB via the drizzle adapter; tables in `src/lib/db/sqlite/schema/auth.ts`
(`user`, `session`, `account`, `verification`, `passkey`, `rateLimit`). Config:

- `baseURL` = `AUTH_URL` (required in production; dev falls back to `http://localhost:4999`),
  `secret` = `AUTH_SECRET`, cookie prefix `sampolio` (`__Secure-sampolio.session_token` over
  https), `advanced.database.generateId: 'uuid'` (user ids stay UUIDs for `getUserDir` and
  shared-member references), IP from `cf-connecting-ip` / `x-forwarded-for`, database-backed
  rate limits (tighter `customRules` on sign-in/up, change-password and the passkey routes;
  windows and limits in `src/lib/auth/rate-limit-rules.ts`).
- **DB sessions**, 30 days, refreshed daily. **No cookie cache**: a signed cache cookie would
  outlive a revocation. `auth()` (`src/lib/auth.ts`) wraps `getSession` in React `cache()` and
  keeps the old `{ user: { id, email, name, role } } | null` shape for every call site; it
  re-checks `isActive`/`deletedAt`, so a deactivated user loses access on the next request.
  That validity rule is `toAppSession` (`src/lib/auth/session.ts`), shared with the proxy's
  auth-page lookup `getProxySession` (`src/lib/auth/server.ts`: a second Better Auth instance
  without `nextCookies`, `getSession` with `disableRefresh`).
- **Passwords**: new hashes are Better Auth scrypt. Legacy bcrypt hashes (carried over from the
  pre-4.0 user files) verify through `bcryptjs` (`password.verify` branches on `$2`) and are rehashed
  to scrypt by the `/sign-in/email` after-hook.
- **User fields** (`user.additionalFields`, all `input: false`): `role`, `isActive`,
  `deletedAt`, `avatarVersion`. No admin plugin — no `/admin/*` HTTP surface, no impersonation;
  admin actions go through `src/lib/actions/admin.ts` → `src/lib/db/users.ts`.
- **Fail closed**: `src/lib/db/sqlite/bootstrap.ts` (boot) records any open or user-store failure in
  `setup-state.ts`; while set, or while `users/*` data dirs exist but the DB has no user rows
  (`isAuthSetupComplete` in `user-store.ts`), sign-up and session creation throw **503
  `SETUP_INCOMPLETE`**, `/api/auth/*` returns 503 and `auth()` returns null. A DB file created
  by the failed boot is deleted. Details: [`operations.md`](operations.md) §1.
- **Hooks**: `databaseHooks.session.create.before` refuses inactive/deleted users for every
  sign-in method (403 `ACCOUNT_INACTIVE`); `user.create.before` makes the first user admin —
  only on a truly fresh install (`isFirstUserSetup`: no user rows, no `users/*` data dirs).
  `hooks.before`: `/sign-up/email` enforces `selfSignupEnabled` (unless first user), the name
  rule and `passwordPolicySchema` (`src/lib/schemas/auth.schema.ts`; `disableSignUp` stays
  false because it would also block the server-side `auth.api.signUpEmail`). The sign-up gate
  **fails closed**: a missing `app_settings` row reads as `selfSignupEnabled: isFirstUserSetup()`
  (`defaultSettings` in `src/lib/db/app-settings.ts`), i.e. disabled once any user exists.
  `/change-password` (reached only through `auth.api.changePassword`) enforces the same policy; `/sign-in/email` returns **429 `ACCOUNT_LOCKED` + `retryAfter`**
  from the in-memory lockout (`isAccountLocked` in `src/lib/db/users.ts`, 10 failures / 15 min);
  `/passkey/generate-register-options` returns **403 `PASSKEY_REAUTH_REQUIRED`** when the
  session is older than `PASSKEY_REGISTRATION_MAX_SESSION_AGE_MS` (10 min,
  `src/lib/auth/constants.ts`). `hooks.after` on `/sign-in/email` records failures (401 only,
  also for unknown emails) / successes and performs the bcrypt → scrypt rehash; on
  `/passkey/verify-authentication` it stamps `passkey.lastUsedAt` (see Passkeys).
  `disabledPaths: ['/update-user', '/change-password']`: profile edits go through our own
  actions, and password changes only through `changeMyPassword`, whose per-user lockout the
  raw endpoint lacks (`disabledPaths` is enforced by the HTTP router only, so the server-side
  `auth.api.changePassword` keeps working). Admin-set passwords (`createUser`/`updateUser` in
  `src/lib/actions/admin.ts`) use the same `passwordPolicySchema`.
- **Recent sign-in for destructive self-service**: `resetMyData` and `deleteMyAccount`
  (`src/lib/actions/account.ts`, `requireRecentSignIn`) refuse with
  `RECENT_SIGN_IN_REQUIRED_MESSAGE` unless the session is younger than
  `PASSKEY_REGISTRATION_MAX_SESSION_AGE_MS` (10 min), so a stolen long-lived cookie cannot wipe
  everything in one call.
- **Action-level limits** (Better Auth's rate limiter only runs on its HTTP router, not for
  `auth.api.*`): `changeMyPassword` uses the lockout map keyed `pw:<userId>` (10 wrong
  current passwords / 15 min → refused with a retry time); `signUp` allows 5 per client IP per
  10 min and 30 globally per hour (`src/lib/rate-limit.ts`).
- **Passkeys** (`@better-auth/passkey`): `rpID` = hostname of `AUTH_URL`, `rpName` "Sampolio",
  `origin` = `AUTH_URL` origin. Passkeys sit alongside passwords (never passkey-only). The
  default name (`defaultPasskeyName`, `src/lib/passkey-name.ts`, set in
  `registration.afterVerification`) is the AAGUID provider (`getAuthenticatorName`, e.g.
  "Apple Passwords", "1Password"); for an unknown or all-zero AAGUID — Apple platforms send
  all zeros under `attestation: "none"` — the registering request's user agent
  ("Safari on iPhone", "Chrome on Mac"); else "Passkey". A client-sent name wins;
  `passkey.lastUsedAt` (Sampolio column) is stamped by the `hooks.after` on
  `/passkey/verify-authentication` (`stampPasskeyLastUsed`) only once a session was created,
  scoped to the asserted credential id and that session's user, so a refused sign-in (a
  deactivated user, a failed assertion) is not a use. Not in the plugin's
  `authentication.afterVerification`, which runs before the session exists.
  `session.freshAge` is **0** because Better Auth's `freshSessionMiddleware` also gates
  `/list-sessions`, `/unlink-account` and `/delete-user`; the narrower 10-minute guard above
  stops a stolen, older session cookie from enrolling a passkey that would survive a password
  change. A session from any sign-in method (password or passkey) counts as fresh. Password
  reset and deactivation keep passkeys; removal is the explicit admin **Remove passkeys**
  (`removeUserPasskeys`) or self-service delete.
- **Dev bypass**: a server-only endpoint (`createAuthEndpoint.serverOnly`, never on the HTTP
  router) registered only when `NODE_ENV !== 'production'` **and** `DEV_AUTH_BYPASS` is set;
  `/dev-login` (`src/app/dev-login/route.ts`) calls it and forwards the session cookie. The
  route answers only loopback requests (`isLoopbackDevRequest`, `src/lib/auth/dev-loopback.ts`):
  a loopback `Host`, `x-forwarded-host`/`x-forwarded-for` (which Next itself sets) accepted only
  when every value is loopback, and any `forwarded`/`x-real-ip`/`cf-connecting-ip` header
  refused; anything else gets 404. The primary control is the dev server's `127.0.0.1` bind
  ([`operations.md`](operations.md)). `src/proxy.ts` additionally redirects
  cookie-less dev requests for `/` and the auth pages straight to `/dev-login`.

Post-sign-in `?callbackUrl=` goes through `safeCallbackPath` (`src/lib/safe-redirect.ts`):
WHATWG-parsed against the page origin, same origin only, never a `//`/`/\` path — else `/`.

Client: `src/lib/auth-client.ts` — `authClient` (`createAuthClient` + `passkeyClient()`) and a
provider-less `useSession()` shim returning `{ data: session }` in the old shape (memoized, so
`session` is safe in effect deps). Sign-in uses `authClient.signIn.email` / `.signIn.passkey`
(`{ error }` results, never throws); after success it `router.replace`s to the callback.
Sign-up is the `signUp` server action (`auth.api.signUpEmail`; `nextCookies`
sets the cookie). Settings › Account hosts the Passkeys panel
(`src/components/settings/passkeys-panel.tsx`); on `PASSKEY_REAUTH_REQUIRED` it offers
"Sign in again" (sign out → `/auth/signin?callbackUrl=/settings?tab=account`).

User ids are the UUIDs that key the finance rows (`userId`) and the `users/<id>/` dirs (created
for every user; avatars). At boot `src/lib/db/sqlite/user-store.ts` (`verifyUserStore`)
refuses a DB with no user rows while `users/*` dirs exist (a lost or wrong `sampolio.db`),
`verifyFinanceStore` refuses a pre-6.0 DB (users, no finance rows, no `file-data-imported`
marker), and `isAuthSetupComplete()` /
`isFirstUserSetup()` apply the same check to sign-up and session creation (see
[`operations.md`](operations.md) §1, fail-closed boot). Soft-deleted users keep their row with
the tombstone email `deleted+<id>@invalid`.

In production an outer **Cloudflare Access** layer authenticates before requests ever reach
the app — see [`operations.md`](operations.md).

## 10. Middleware & security

`src/proxy.ts` (Next.js 16 proxy, **Node.js runtime**; cookie-presence checks, plus one session
lookup on the auth pages). Matcher: everything **except** `_next/static`, `_next/image`,
`favicon.ico`, `manifest.webmanifest`, `sw.js`, `offline.html`, `icons`, and
`*.png|jpg|svg` (PWA/install assets must load without auth). Behavior:

- **Rate limiting** (in-memory `Map` per client IP — `clientIpFrom`: `cf-connecting-ip`, then
  the first `x-forwarded-for` hop — 1-minute window, resets on restart):
  unauthenticated requests to `/api/auth*` or `/auth/*` → **20/min**; all other
  unauthenticated requests → **300/min**. Requests bearing a session cookie are exempt
  (server actions burst hundreds of POSTs per page load). 429 with `Retry-After`.
- **Auth redirect** for cookie-less `/` and every path in `PROTECTED_PREFIXES` (see §3).
- **Session cookie** detection: `getSessionCookie(req, { cookiePrefix: 'sampolio' })` from
  `better-auth/cookies`.
- **Auth pages** (`/auth/signin`, `/auth/signup`) with a session cookie: the proxy looks the
  session up (`getProxySession`, same `toAppSession` rule as `auth()`). **Valid** → a GET is
  redirected to its `?callbackUrl=` (`safeCallbackPath`, never back to `/auth/*`) or `/`, so
  visiting the sign-in page never signs you out; a POST (server action) passes through.
  **Rejected** (no row, expired, deactivated, setup failed) → the cookie is expired and the
  page renders; that is what breaks the protected page → sign-in → protected page loop, and it
  cannot loop because both sides use the same rule. **Lookup failed** (DB error) → the page
  renders, cookies untouched. Pre-4.0 `authjs.*` / `next-auth.*` cookies are always expired.

Security headers are set for every route in `next.config.ts` (`headers()`):
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-DNS-Prefetch-Control: off`,
`Permissions-Policy` (camera/mic/geo/topics off), `Strict-Transport-Security`, and a CSP
(key directives: `default-src 'self'`; `script-src` allows `unsafe-inline` for Next, and
`unsafe-eval` only outside production — `next dev` needs it for HMR/React Refresh; `style-src 'unsafe-inline'` for charts and positioned UI; `worker-src 'self'` for the service
worker; `frame-ancestors 'none'`; plus `img-src`/`font-src`/`connect-src`/`base-uri`/
`form-action` all `'self'`-scoped and `upgrade-insecure-requests` — full list in
`next.config.ts`). `/sw.js` is additionally served `no-cache, no-store` with
`Service-Worker-Allowed: /`. `poweredByHeader: false`.

## 11. Instrumentation & background work

`src/instrumentation.ts` `register()` (Node runtime only): installs
`installTimestampedConsole()` (`src/lib/server-logger.ts` — ISO-timestamp prefix on every
`console.*`), opens the SQLCipher DB (`bootstrapDatabase`), then — when the DB is usable —
`startMaintenanceScheduler()` (`src/lib/db/sqlite/maintenance.ts`, at boot and hourly: deletes
`verification` rows past `expiresAt`, logging `[db] pruned N expired verification row(s)`, and
`rateLimit` rows whose `lastRequest` is older than `rateLimitRowRetentionMs()` — 2 × the longest
rate-limit window, at least 24 h, so live buckets are never reset — logging
`[db] pruned N stale rate-limit row(s)`; both lines always at boot, hourly only when N > 0),
`startSnapshotScheduler()` (boot, every 6 h, daily 04:55) and `startBankScheduler()` (`src/lib/bank/scheduler.ts`, 30-min tick,
per-account daily rate limits from `src/lib/bank/constants.ts`). No other daemons, queues, or
cron exist. Bank-sync mechanics: [`bank-sync.md`](bank-sync.md).

Split-activity Home Assistant webhook POSTs (`src/lib/split-notify.ts`) run
**post-response** via `after()` from `next/server` — the codebase's only use of that
hook — so the mutation returns before any outbound HTTP happens. Fire-and-forget: no
retry, no queue. Contract and opt-outs: [`features.md`](features.md) §1.

## 12. PWA

Installable PWA: `src/app/manifest.ts` (static manifest, `display: standalone`, theme
`#2F6B4F`), master icons in `public/icons/` (regenerate PNGs with
`node scripts/generate-icons.mjs`), and `public/sw.js` registered by
`<ServiceWorkerRegister>` in the root layout (production-only, no-op on localhost).
`sw.js` strategies: GET + same-origin only; never intercepts `/api/`, `/auth/`, or RSC
requests; **network-first** for navigations with `public/offline.html` fallback;
**cache-first** for hashed `/_next/static/*` — storing only successful same-origin responses
(`res.ok && res.type === 'basic'`, never a 404/5xx from a deploy restart or an opaque/redirected
one) and trimming the oldest entries beyond `MAX_STATIC_ENTRIES` (300, ~3 builds of chunks)
after each put; **stale-while-revalidate** for `/icons/*`; everything else
uncached. The service worker disables itself on `localhost`/`127.0.0.1`.
`src/test/service-worker.test.ts` runs `sw.js` in a sandbox to pin these rules. `CACHE_VERSION` (currently `'v12'`) must be bumped on
any deploy that changes cached assets. Responsive/PWA UI rules: root `AGENTS.md`
and [`src/components/AGENTS.md`](../src/components/AGENTS.md).

## 13. Frontend structure

`src/components/`:

| Directory | Contents |
|---|---|
| `layout/` | `AppLayout` (AppContext + ToastProvider host; no session provider — `useSession` is the Better Auth store), `SidebarNav`, `MobileTopBar`, `BottomNav` (1–4 user-chosen tabs + fixed "More"; resolved by `src/lib/bottom-nav-prefs.ts` from `UserPreferences.bottomNavIds`, customizable in Settings → General), `MobileNavDrawer`, shared `nav-config.tsx` (single source for all four nav surfaces) |
| `providers/` | `ThemeProvider`, `ToastProvider`, `CelebrationProvider`, `ServiceWorkerRegister` |
| `charts/` | ECharts/Chart.js components (cashflow waterfall, treemap, monthly flow, net-worth, wealth, scenario comparison, split spend/net); no barrel — import each module directly |
| `modals/` | Cashflow item modal, occurrence-override dialog, users (admin) modal |
| `home/` | `HomeDashboard` (bank glance strip, projected-month tile, merged split balances + activity card) |
| `bank/` | Connections settings panel, account picker, transaction ledger table, account-order dialog |
| `cashflow/` | Collapsing header, month strip, month-details panel, projection table |
| `overview/` | `BannerStack`, `KpiGroup`, plan-check card (`forecast-vs-actual-card.tsx`), net-worth explain dialog |
| `budgets/` | Merged-page Budgets section, setup wizard, verdict card, coverage bars, expense log, dialogs |
| `goals/` | Goal card, create/edit dialog |
| `trips/` | Merged-page Trips section, trip card, create/edit dialog, per-diem breakdown |
| `mortgage/` | Setup wizard, ledger table, charts, Sankey, reconcile/import dialogs |
| `split/` | Quick-add modal, `SplitEditor`, expense/settle/recurrence/import dialogs, activity feed, `group-period-card` (last-30-days insights) |
| `onboarding/` | Onboarding wizard |
| `reconcile/` | Reconciliation wizard |
| `ui/` | `CommandPalette`, `EntityListDrawer`, `EntityModalRouter`, `KpiTile`, `AlertBanner`, `HelpHint`, `EmptyState`, skeletons, delayed-loading primitives, form primitives |

State management is React Context only — `AppContext` in
`src/components/layout/app-layout.tsx` (drawer state, the shared `accounts` list +
`accountsLoaded`, `refreshData`, sidebar state); no Redux/Zustand. Hooks
(`src/lib/hooks/`): `use-data-refresh.ts` (client data freshness, below), `use-delayed-flag.ts` (spinner debounce), `use-form-submit.ts` (Enter
submits dialog forms, §17), `use-media-query.ts` (SSR-safe `useIsMobile`), `use-month-selection.ts`
(cashflow month selection), `use-reduced-motion.ts`, and `use-dwell-seen.ts` (split
"seen" dwell tracking).

**Client data freshness.** Pages are client components that load data with server
actions into `useState`, so `updateTag` alone never reaches what is on screen. The one
mechanism is the bus in `src/lib/hooks/use-data-refresh.ts`: every successful mutation
calls `notifyDataChanged()` (shared mutating components do it themselves;
`AppContext.refreshData()` / `EntityModalRouter`'s `onDataChange` forward to it), and every
data view subscribes its refetch with `useDataRefresh(refetch)`. A notification refetches
all mounted subscribers in one coalesced round and reaches the user's other tabs and PWA
windows over a `BroadcastChannel`; returning to the app (tab visible / window focus,
throttled to 15 s) refetches too, which is how background bank syncs and other members'
split/mortgage edits appear. Routes hidden by Next's Activity unsubscribe while hidden and
replay a missed change when shown again. Refetches must keep the last good data on
failure, never flash a full skeleton (`hasLoadedOnce` guards) and never overwrite form
drafts — form-heavy views subscribe with `{ focus: false }` or not at all. Forms use React Hook Form +
Zod resolvers with app-owned controlled inputs wrapped in `Controller`. Pure calculation engines live
beside the UI in `src/lib/` (`projection.ts`, `wealth-projection.ts`,
`mortgage-projection.ts`, `retrospective.ts`, `split-utils.ts`, `budget-utils.ts`, etc.) —
see [`projections-and-reconciliation.md`](projections-and-reconciliation.md) and
[`features.md`](features.md).

## 14. Types & schemas

All domain types (entities, `Create*`/`Update*Request`, `ApiResponse<T>`, projection shapes)
are centralized in the single file `src/types/index.ts` (the `auth()` session shape is
`AppSession` in `src/lib/auth.ts`). Zod form/action schemas live one-per-feature in `src/lib/schemas/`
(`auth`, `bank`, `budget`, `cashflow-item`, `data-transfer`, `goal`, `mortgage`,
`occurrence-override`, `planned-item`, `recurring-item`, `salary-config`, `split`, `trip`).
Entity IDs are `uuid` v4 strings (Better Auth rows too, via `generateId: 'uuid'`).

## 15. Testing

Vitest (`vitest.config` + `src/test/setup.ts` with jest-dom + jsdom stubs for
localStorage/matchMedia; mock factories in `src/test/mocks.ts`; `src/test/render.tsx`
wraps components in ThemeProvider). ~100 test files:

- **Pure engines** (`src/lib/*.test.ts`): `projection`, `wealth-projection`,
  `mortgage-projection` (exact-match reference-spreadsheet reproduction), `mortgage-utils`,
  `mortgage-transfer-utils`, `retrospective`, `current-month-actuals`, `salary-utils`,
  `taxed-income-utils`, `budget-utils`, `budget-csv`, `csv-utils`, `debt-utils`,
  `goal-utils`, `per-diem-utils`,
  `bank-utils`, `maintenance-utils`, `split-utils`, `split-draft`, `split-csv`,
  `split-notify` (pure payload builder + opt-out gate + the fire-and-forget transport
  with a stubbed `fetch`; `notifySplitActivity` itself is out of scope — `after()`
  needs a request scope), `bank-split-match`, `data-transfer-utils`, `scenario-utils`,
  `chart-descriptions`, `live-anchor`, `projection-inputs`, `reconcile-prefill`,
  `wealth-assembly`, `wealth-inputs`, `overview-hero`, `latest-snapshots`, `html-escape`,
  `date-format`
- **Bank engine** (`src/lib/bank/*.test.ts`): `card-billing`, `dedup`, `mappers`,
  `reconcile-links`, `link-identity`, `apply-link-balances`, `scheduler`,
  `card-payment-match`, `repair-booking-dates`, `connect` (renewal keeps the live session)
- **DB layer** (`src/lib/db/*.test.ts`): `encryption`, `budgets`, `planned-items`,
  `reconciliation`, `data-transfer`, `taxed-income`, `split-groups`, `app-settings`,
  `path-guard` (id/path guards); `src/lib/db/sqlite/sqlite.test.ts`
  (temp SQLCipher DB: plaintext header absent, wrong/no key fails, idempotent migrations,
  verified encrypted snapshot); `bootstrap.test.ts` (user-store gate: lost/wrong DB next to
  user data fails closed, first-user rule)
- **Auth** (`src/lib/auth/server.test.ts`, temp DB via `src/test/temp-data-dir.ts`): sign-up
  gating + first-user admin, weak-password/`input:false` rejection, bcrypt sign-in + scrypt
  rehash, deactivation (sign-in 403 and `auth()` → null), soft/hard delete, lockout 429,
  passkey-registration re-auth window, UUID ids; `src/components/settings/passkeys-panel.test.tsx`
  (list, add, cancel, `PASSKEY_REAUTH_REQUIRED` prompt)
- **Schemas** (`src/lib/schemas/*.test.ts`): `auth.schema`, `cashflow-schemas`,
  `occurrence-override.schema`
- **Convenience engines** (`src/lib/*.test.ts`): `category-utils`,
  `recurring-detection`, `forecast-vs-actual`, `bottom-nav-prefs`
- **Actions** (`src/lib/actions/*.test.ts`, temp `DATA_DIR`, `auth()` and `next/cache`
  mocked): `goals`, `trips`, `user-preferences`, `dashboard-data`, `split-groups`,
  `split-groups-bank`, `auth-actions` (real Better Auth on a temp DB), `partial-updates`
  (absent key keeps, `null` clears); `src/lib/auth/dev-loopback.test.ts`
- **Guards** (`src/test/`): `no-native-confirm` (no `window.confirm` in `src/`),
  `service-worker` (runs `public/sw.js` in a sandbox with fake Cache Storage)
- **Local-only parity suites** (`*.local.test.ts`, **gitignored**): mirror a
  committed suite but assert against the maintainer's real financial records
  (`mortgage-projection.local`, `split-csv.local`). Vitest's default glob picks
  them up, so `pnpm test` runs them locally; they never ship. Every *committed*
  fixture is synthetic — invented figures, placeholder people. Change an engine
  and you update both halves.
- **Components** (`src/components/**/*.test.tsx`, jsdom via a
  `// @vitest-environment jsdom` docblock per file): the shared UI primitives
  (`alert-banner`, `kpi-tile`, `empty-state`, `help-hint`), `use-form-submit`,
  `split-spend-chart`, plus the highest-state components —
  the cashflow item modal, the split editor, and the reconcile wizard (server
  actions mocked with `vi.mock`)

**Unit coverage remains partial for** feature pages, server actions (auth/validation/cache-tag
behavior beyond the action slice listed above), and bank client/sync modules. `src/proxy.test.ts` covers the auth-page session
handling (redirect / clear / render, plus a redirect-following loop check) against a real temp
DB; `src/lib/auth/passkey-registration.test.ts` and `passkey-sign-in.test.ts` run full passkey
registrations and sign-ins with a software authenticator (`src/test/soft-authenticator.ts`);
`src/app/api/bank/callback/route.test.ts` and `src/lib/actions/bank-psu.test.ts` check the PSU
IP the bank callback and "Refresh now" pass on. Manual
verification uses the configured preview launcher and available browser automation.

The committed Chromium suite (`e2e/`, `playwright.config.ts`) exercises synthetic
password/passkey authentication, every route, representative mutations/import/export,
number/date entry, nested overlays, table controls, preferences and accessibility at
390/768/1280px. `scripts/browser-fixture.mjs` requires Node 26 and a clean worktree
without `.env*` files, creates disposable encrypted data and secrets, blanks external
banking/webhook configuration and binds loopback port 4999. Production mode builds
and starts that isolated bundle. One Chromium worker, no WebKit/WebGL on this host.
`e2e/material-surfaces.spec.ts` exercises every Settings and Mortgage tab, auth/offline
surfaces, capsule selection, contrast and reduced-transparency fallbacks. Route smoke
checks wait for loaded content before checking material bounds and opaque data cards.
`e2e/material-regressions.spec.ts` also checks sidebar centering, short-height scrolling,
calendar placement, modal blur and immediate Demo updates without losing drafts.
`e2e/material-polish.spec.ts` adds multi-bank/account containment, active-tab geometry,
uniform switch sizing and darker scrim fallbacks; mortgage workflow checks require the
whole current-month row to fit between mobile chrome.
Screenshots require manual material/readability review; axe alone is insufficient.
Real iPhone Safari/PWA keyboard and compositing behavior remains a separate device check.
`scripts/bundle-metrics.mjs` reports aggregate raw/gzip static chunks, not per-route
first-load transfer. Generated reports and synthetic auth state are gitignored.

## 16. Tooling

`package.json` scripts: `dev` (loopback port 4999), `dev:preview` (additionally
sets `DEV_AUTH_BYPASS`), `build` (`next build`), `start`, `lint` (`eslint`),
`test` / `test:watch` / `test:coverage` (Vitest). `test:e2e`,
`build:synthetic`, and `test:e2e:production` already invoke the host heavy-job guard;
do not nest another guard around them. The synthetic production suite builds and
starts a disposable, isolated app through `scripts/browser-fixture.mjs`.

**Port convention**: production (`com.sampolio.app`, `next start`) owns **3999**; dev
(`pnpm dev` or the `.claude/launch.json` `sampolio-preview` config) runs on **4999** against a
`./data` copy — no collision with prod. Prod builds into `.next-prod` via
`NEXT_DIST_DIR`; dev uses `.next`.

Lint: flat config `eslint.config.mjs` = `eslint-config-next/core-web-vitals` +
`eslint-config-next/typescript`, ignoring `.next/`, `.next-prod/`, `out/`, `build/`.

## 17. Shared UI implementation rules

The component inventory is in [`src/components/AGENTS.md`](../src/components/AGENTS.md).
This section owns cross-cutting UI behavior; display-mode and money-masking details
live in [`features.md`](features.md#10-demo-mode-ui-only-money-masking).

### Component source provenance

`components.json` selects shadcn's Base UI registry (`base-nova`). The app-owned
controls adapt the reviewed MIT recipes for
[button](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/button.tsx),
[dialog](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/dialog.tsx),
[select](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/select.tsx),
[table](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/table.tsx) and
[calendar](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/calendar.tsx).
They are maintained source, not exact registry copies: financial field contracts,
material classes, responsive overlays and the TanStack v9 table adapter are local.
Calendar imports use `@daypicker/react` v10. Upstream attribution is retained in
[`ui/LICENSE.shadcn`](../src/components/ui/LICENSE.shadcn); installed packages retain
their own license notices. Generation tooling is not a runtime dependency.

### Material system and theme

`src/app/globals.css` owns the shared tokens and materials, following
[Apple material guidance](https://developer.apple.com/design/human-interface-guidelines/materials).
Opaque/strongly filled surfaces hold money, rows, charts and editable forms. Regular
glass belongs to floating navigation, toolbars and contextual controls; avoid nested
blur and clear glass over financial content. System fonts, tabular financial numerals,
rounded controls and the green accent retain Sampolio's identity. Semantic category
colors remain; `src/lib/color-contrast.ts` chooses legible text on solid fills.
Neutral surfaces use `bg-card`/`bg-muted`, `border-border` and foreground tokens
instead of fixed gray or blue palettes.

Shared composition lives in `src/components/ui/page-header.tsx`:

- `PageHeader` is a nonsticky bounded title/action rail, with wrapping mobile actions.
- `MaterialToolbar` groups independent controls. Opt-in sticky rails clear mobile
  chrome at `4.5rem + safe-area-inset-top`; desktop uses `0.5rem + safe-area-inset-top`.
- `ControlGroup` is solid inset material inside existing cards or glass. Tabs,
  segmented controls and wizard Steps own inset rails; selection is a raised capsule.
  Inputs keep inset edges, buttons use rounded filled/outlined treatments, and table
  pagination uses the same control materials. Neutral text uses foreground tokens.

| Surface | Material composition |
|---|---|
| Home, Overview, Goals, What If?, Settings | Shared title rail, filled financial/form cards; Overview quick actions use a separate toolbar. Loading/error shells retain the heading. |
| Cashflow | Sticky material toolbar with selected-month controls; month rows, mobile cards and editable forms stay filled. |
| Bank | Title rail, sticky bank/account toolbar and separate ledger search rail; account chips, summary and transaction data stay filled. |
| Mortgage | Title/manage rail, capsule tabs, solid chart/schedule controls and setup steps; ledger and charts remain opaque. |
| Trips & Budgets, budget detail | Title/section-action rails with filled planning, expenses and calculator forms; `/trips` redirects to `/budgets`. |
| Split list/detail | Title/actions and inset view controls; expense, group, settlement and import dialogs retain filled editable content. |
| Authentication, command palette, overlays | Glass header without a filtered parent; opaque form/results/footer. Public auth uses a green-tinted background. |
| Offline | Existing readable offline surface and 44px retry action; stable asset/cache rules remain in §12. |

Glass is a control layer, not a requirement to blur every element. Nested
`.glass-chrome` surfaces flatten to an opaque card. Reduced-transparency and increased-
contrast preferences override all rails; semantic category and status colors remain.
The desktop shared-expense shortcut stays in the sidebar above independently scrolling
routes, and mobile uses the top bar, so neither overlays financial rows.

`ui/chart.tsx` and `ui/chart-theme.ts` apply `--muted-foreground` and `--border`
to Chart.js legend/axis text and neutral grid/borders per instance. Immediate light/dark
fallbacks cover the theme update until CSS tokens resolve after the DOM commit.
Theme changes redraw options without remounting; datasets, callbacks, filters, inline
plugins and tooltip settings retain their identity. Doughnuts do not gain cartesian axes.

Dialog/sheet roots remain transparent and do not establish a backdrop filter: the
strongly filled header blurs its own background, while content and action rows stay opaque.
The separate shared scrim (including command palette and confirmation) dims the page
with 55% dark ink and a 1px backdrop blur. Reduced transparency or increased contrast
removes that blur and raises dimming to 72%; scrims never filter their foreground controls.
In CSS, place `-webkit-backdrop-filter` before `backdrop-filter` so minification
preserves the standard declaration. Material acceptance checks compare rendered
header pixels with blur enabled/disabled, as well as computed styles and solid
reduced-transparency fallbacks.

`ThemeProvider` retains `sampolio-theme` and adds device-local
`sampolio-reduce-transparency`; OS increased contrast/reduced transparency also force
stronger materials. The root pre-paint initializer sets the theme before paint and
synchronizes browser theme color. ThemeProvider renders children during SSR;
AppLayout keeps its route children mounted but invisible/inert until device preferences
are ready, preventing an unmasked first paint. Root and dashboard auth boundaries use
Suspense; `partialPrefetching: false` retains the established route caching behavior.

### Feedback & loading UX (perceived performance)

Every mutation should confirm; every load should feel instant. The primitives:

- **Global toast** — one Base UI Toast provider in `ToastProvider`; use `useToast()` → `success/error/info/show`, with application-owned message types, arrays, lifetimes and sticky messages. Never mount feature-local toast providers.
- **Global confirm dialog** — one Base UI AlertDialog coordinator (`ui/confirmation.tsx`) mounted in `AppLayout`. `requestConfirmation(options): Promise<boolean>` queues requests, resolves once after dismissal, and defaults to Confirm/Cancel with reject focus. The callback facade `confirmDialog(options)` preserves Yes/No with accept focus; explicit labels/focus override defaults. Sign-out/unmount cancels pending requests; accepted callback failures show a toast. Never mount another receiver or call native `confirm()`.
- **Delayed loading** — `useDelayedFlag(active, 300)` (`src/lib/hooks/use-delayed-flag.ts`) reveals a flag only after `active` holds for ~300ms and drops it instantly when false, so fast ops (the norm after the HKDF encryption fix) never flash a spinner. `DelayedSpinner` / `DelayedSkeleton` (`src/components/ui/delayed-loading.tsx`) build on it.
- **Instant shell + skeletons** — heavy pages render their chrome immediately and show a content-shaped, delayed skeleton for the data region instead of a full-page `ProgressSpinner`. Reusable layouts in `src/components/ui/skeletons.tsx` (`KpiGridSkeleton`, `ChartsPageSkeleton`, `ListPageSkeleton`, `HomeSkeleton` — Home's glance/balances/activity region, `SplitDetailSkeleton`). Skeletons must match the real content's position AND height — a skeleton taller than what it replaces makes content jump on load. Pages fetch with a first-load-only `loaded` flag: refetches update silently and never re-show the skeleton; register the AppContext refresh callback in a **separate** effect from the fetch effect (goals/page.tsx is the reference pattern).
- **Optimistic UI** — on daily-driver hot paths (e.g. split-expense delete, recurring pause/resume in `split/[id]/page.tsx`), apply the change to local state immediately + toast + reconcile with a background refresh; on failure, roll back the snapshot and toast the error. Server actions/schemas are unchanged.
- **Chart code-splitting** — heavy charts are lazy via `next/dynamic({ ssr: false, loading })`: the ECharts trio on cashflow (`monthly-flow`/`cashflow-waterfall`/`expense-treemap`) and the seven mortgage charts (one shared chunk). The **modal router is lazy too**: `entity-modal-router.tsx` (mounted by `AppLayout` on every page) `next/dynamic`s `CashflowItemModal`, `EntityListDrawer`, `UsersModal`, and `QuickAddSplitModal`, so none of them ship in the shared first-load bundle. Keeps each page's initial JS small.
- **Shared UI primitives** (`src/components/ui/`) — use `AlertBanner` for reminder/attention banners, `KpiTile` for KPI cards (zero-delta change badges are suppressed automatically; optional `help` prop renders a plain-language hint), `HelpHint` for tap-friendly "?" explanations, and `EmptyState` for empty lists; never hand-roll these per page.
- **Chart explanations** (`src/components/ui/chart-explain.tsx` + pure engine `src/lib/chart-descriptions.ts`, unit-tested) — EVERY canvas chart gets an "Explain" button opening an inline `.collapse-grid` panel with (a) canned "How to read this chart" cue rows (`ChartCueSwatch` color/shape swatches matching the real palette) and (b) a generated "in plain words" description built from the chart's own data (money ALWAYS via `formatCurrency` with `demoMasked` in the describe `useMemo` deps; sentences ≤ ~15 words; proportions via `shareToWords`). An sr-only copy is always rendered and wired via `aria-describedby`. The panel defaults OPEN in Simple display mode (words first). The three cashflow charts additionally have step tours (`useChartTour` + `ChartTourBar`, ECharts `dispatchAction` highlights). New charts must integrate via the `ChartExplain` wrapper and add a describe function + test to `chart-descriptions.ts` — never ship a bare canvas chart.
- **Plain language** — `src/lib/plain-language.ts` is the single jargon→everyday-wording map (`plainTerm(key, isSimple)` picks the wording per display mode, `helpText(key)` feeds `HelpHint` tooltips). One concept, one name app-wide (e.g. reconciliation is always "monthly check-in" in UI copy; Euribor banners lead with "mortgage interest rate"). Add new finance terms to the map, never inline in a component.
- **Category colors** — `CATEGORY_COLORS` + `getCategoryColor(category)` in `src/lib/constants.ts` is the single category→color map (warm = discretionary, cool = fixed/income; covers cashflow ITEM_CATEGORIES **and** the SPLIT_CATEGORIES names) used by the expense treemap, the cashflow Sankey, category badges, the split spend chart's By-category mode, the split group-detail category treemap, and the plan-check card's dots. Never assign category colors positionally.
- **Category auto-suggest** — `guessItemCategory(name)` (`src/lib/category-utils.ts`, pure/tested) prefills the cashflow item form's category from the name (the split quick-add has its own `guessCategory` for split categories), and also recategorizes bank merchant names (incl. common Finnish chains) for the Overview plan-check card. Suggestions re-evaluate while auto-set and stop once the user picks manually.

### Motion (animations, transitions, press feedback)

Motion is feedback, never choreography: 120–250ms, opacity/transform only, CSS-first (no
motion library), and it must never gate input. The primitives:

- **Tokens** — durations `--motion-fast` (120ms, press), `--motion-base` (180ms, hovers/fades),
  `--motion-slow` (250ms, entrances/expanders) on `:root` in `src/app/globals.css`; easings
  `--ease-fluid` (entrances) / `--ease-snap` (press/settle) in its `@theme` (→ Tailwind
  `ease-fluid`/`ease-snap` utilities). Never hardcode new durations/curves — consume the tokens
  (CSS files use `var(--motion-*)`).
- **Entrance utilities** — `animate-fade-in` (180ms opacity), `animate-rise-in` (250ms opacity +
  8px rise), `animate-scale-in` (160ms; command palette). They're *mount* animations with the
  default `none` fill — NEVER add `forwards`/`both`: a filled entrance keeps the element
  permanently promoted (own stacking context/composited layer), which breaks `backdrop-filter`
  on glass headers above it (content stays crisp instead of blurring). Apply to a wrapper that
  mounts once (skeleton→content swap, conditional-render reveals like "Show archived");
  refetches must not remount the wrapper. Caution: they animate `transform`, so never put one on
  an element that positions itself with `-translate-*` utilities (wrap it instead — see the
  command palette's inner/outer split).
- **Page entrance** — `PageEntrance` (`src/components/ui/page-entrance.tsx`) wraps page content
  in `rise-in` and imperatively RESTARTS it on pathname change; a bare `animate-rise-in` on a
  route wrapper never plays because Next 16 pre-mounts prefetched routes hidden (the animation
  clock is spent before reveal; layout effects fire at reveal, hence the restart). Used by
  `src/app/(dashboard)/template.tsx` and Home (`home-dashboard.tsx`, outside the group).
- **Press/hover** — `.pressable` in globals.css gives card surfaces short active feedback
  and pointer-only hover shadows. Buttons use `.ui-button`; inputs never scale on press.
  Text/list rows use color feedback. Hand-written hover styles require a hover-capable pointer.
- **Cursor** — native buttons and role buttons receive pointer cursors in globals.css.
- **Reduced motion** — the global kill-switch in globals.css reduces animation/transition
  durations; JavaScript motion uses `useReducedMotion()`.
- **Expanders** — `.collapse-grid`/`.is-open` (globals.css) animates auto-height for
  always-mounted content (add `inert` when closed); conditionally-rendered or heavy reveals use
  `animate-fade-in` instead.
- **Jiggle-mode reorder** — the shared iOS-style reorder primitive
  (`src/components/ui/jiggle-reorder.tsx`: `useJiggleReorder` hook + `JiggleModeBar` bottom pill;
  pure math in `src/lib/reorder-utils.ts`). A long-press (~500ms) enters a persistent "jiggle
  mode": every item wobbles and any item can be dragged to a new slot (FLIP-style sibling shifts
  on the motion tokens); Escape/Done (or the bar) exits. Keyboard + sr-only entry buttons make it
  a11y-complete. The wobble (`jiggle-wobble`, ±1deg infinite) lives on the inner
  `[data-jiggle-inner]` element while the drag translate lives on the outer `[data-jiggle-item]`,
  so the two transforms never collide. Non-passive native `touchmove` `preventDefault` keeps the
  drag from scrolling the page. Used by **/split** (group list → `UserPreferences.splitGroupOrder`),
  **/bank** (one shared mode across two rows — connection tabs + accounts within the active
  connection → `bankAccountOrder`), and **Settings → General → Mobile navigation**
  (`mobile-nav-card.tsx` bottom-nav tab preview → `bottomNavIds`). Skipped entirely under reduced motion (the hook bails via
  `useReducedMotion()` and the CSS wobble is killed).
- **Celebrations** — `useCelebration().celebrate('checkmark' | 'confetti')`
  (`src/components/providers/celebration-provider.tsx`, mounted inside `ToastProvider` in
  `app-layout.tsx`): a ~1.5s checkmark badge-pop on split-expense create (an expanding ring
  ripple + a 6-dot burst, then a 450ms check draw; overlay unmounts at ~1550ms) and a ~1.5s
  hand-rolled canvas confetti burst on settle-up. Classes `celebrate-container`/`-ring`/`-badge`/
  `-dot`/`-check`, keyframes `celebrate-pop`/`-draw`/`-ring`/`-dot` in globals.css — every
  animation in that block uses the `forwards` fill (the whole overlay unmounts, so there is no
  lingering-composited-layer concern the entrance utilities have; a no-fill pop reverted to its
  start frame before unmount and flickered). Both render `z-[2000] pointer-events-none` (never
  gate input). The checkmark pop, the confetti burst, and the jiggle-mode wobble above (infinite,
  transform-only, dead under reduced motion) are the THREE sanctioned exceptions to the ≤250ms
  rule — no further exceptions without amending this list. Gated by `useReducedMotion()` — reduced
  ⇒ `celebrate()` returns `false` and callers fall back to the flash-highlight row + toast.
- **Do NOT**: `transition: all`, animating height/width/filter/backdrop-filter, effects >250ms
  (except the three sanctioned exceptions above), count-up on money values, exit animations on
  optimistic deletes or overlay close, list stagger, press effects on inputs. The bottom-nav active pill (`bottom-nav.tsx`) is the one sanctioned
  positional animation (N+1 equal user-chosen cells, `left` calc from `100 / cells`); its `<nav>` must stay `fixed` **without**
  `relative` (fixed already anchors the absolute pill; `relative` would win the cascade and
  un-fix the bar). Don't touch `.progressbar-instant` or `flash-highlight`. In CSS comments,
  never write a star-followed-by-slash glob (e.g. spell `--motion-{fast,base,slow}`) — it closes
  the comment and the parser eats the next rule.

### Responsive & PWA (mobile + desktop)

**Every new page, component, and interface MUST be responsive** — it has to look and work well on a phone (~375px wide) *and* on desktop, with no horizontal overflow. This is a hard requirement, not a nice-to-have. Always check both a mobile (~390px) and a desktop (~1280px) breakpoint before considering UI work done (use any available browser/UI automation with a resized viewport — assert `document.documentElement.scrollWidth <= window.innerWidth`). The app is also an **installable PWA** (Add to Home Screen on iOS/Android/desktop).

- **Breakpoint switch — Tailwind `lg` (1024px)**: below `lg` = mobile chrome, at/above `lg` = the desktop sidebar layout. **Drive visibility with CSS** (`lg:hidden` / `hidden lg:block`) to stay hydration-safe and avoid flashes; only use the SSR-safe `useIsMobile()` / `useMediaQuery()` hook (`src/lib/hooks/use-media-query.ts`) when logic must branch (which component to mount, a numeric prop, `maximized={isMobile}`).
- **Navigation chrome**: desktop uses the fixed collapsible `SidebarNav` (`hidden lg:flex`); mobile uses `MobileTopBar` (hamburger + brand + shared-expense quick-add + search; the monthly check-in deliberately lives on Overview, not in the chrome), `BottomNav` (1–4 user-chosen tabs + a fixed "More"; see `src/lib/bottom-nav-prefs.ts`), and `MobileNavDrawer` (shared Base UI sheet, the full menu). All four nav surfaces read the **shared `src/components/layout/nav-config.tsx`** (`navItems`, `isNavItemActive`, `useUserMenuItems`) — add a nav entry there, never in one surface only. The sidebar/drawer user button renders the user's `UserAvatar` (not a generic icon), and the user-menu's avatar+name+email header item navigates to `/settings?tab=account` — the Settings page maps a `?tab=` slug to the index of its *rendered* tabs (Simple mode hides some), unknown slug ⇒ first tab. `<main>` uses `lg:ml-22`/`lg:ml-68` (no base margin) + top/bottom padding for the mobile bars, all with `env(safe-area-inset-*)` so the iPhone notch / home indicator are respected (root `viewport` sets `viewport-fit=cover`). Mobile chrome (`MobileTopBar`, `BottomNav`) is `z-40`; the desktop `SidebarNav` and dialog/command-palette overlays sit at `z-50`+.
- **Dialogs**: shared `ui/dialog.tsx` uses Base UI portals and focus handling; centered desktop dialogs become bottom sheets at ≤640px. Strongly filled content, independently scrolling bodies, dynamic viewport heights and safe-area padding keep long forms usable. Maximize controls remain; free dragging/resizing is unsupported. Caller dismissal rules, including protected monthly check-in, remain authoritative.
- **Overlay safe-area insets (installed PWA)**: portalled overlays render at the viewport edges (`viewport-fit=cover`), so `globals.css` pads them for `env(safe-area-inset-*)`. Shared sheets pad all relevant edges. Top-anchored `Toast`s drop below the island. Sticky in-page headers must pin **below** the mobile top bar (`sticky top-[calc(4.5rem+env(safe-area-inset-top))] lg:top-[calc(0.5rem+env(safe-area-inset-top))]`), never `top-0` — the `lg:` offset matters because a **desktop-breakpoint installed PWA (iPad)** also runs edge-to-edge under the OS status bar with no mobile top bar to clear it. For the same reason `<main>` keeps `lg:pt-[env(safe-area-inset-top)]`/`lg:pb-[env(safe-area-inset-bottom)]` (not `lg:pt-0`), the desktop `SidebarNav` aside pads itself with both insets, and `AppLayout` paints a solid, unfiltered mobile safe-area cap at the viewport top plus a desktop glass strip, each of height `env(safe-area-inset-top)` (zero in a normal desktop browser). `MobileTopBar` clips its backdrop to a separate rounded background layer; icons/text remain unfiltered. The edge cap is a mitigation consistent with [WebKit’s fixed-edge color extension behavior](https://bugs.webkit.org/show_bug.cgi?id=301756#c2), not proof of installed-iPhone parity.
- **Tables (mixed strategy)**: lighter tables (e.g. cashflow projection, bank ledger) render a `lg:hidden` card/list view beside a `hidden lg:block` DataTable; the wide mortgage ledger keeps a single DataTable with a **frozen first column** (`frozen alignFrozen="left"` + `scrollable`) for horizontal scroll. Don't let a raw wide table overflow the viewport.
- **Charts**: containers must be width-fluid (`width:100%`) with responsive heights (e.g. `h-72 lg:h-96`); Chart.js charts set `maintainAspectRatio:false` and fill the wrapper (don't also pass a fixed `height` prop — they fight). ECharts/Sankey resize to the container; pass a shorter mobile height where it helps.
- **Toolbars / page headers**: stack on mobile (`flex-col sm:flex-row`), full-width controls (`w-full sm:w-auto` / `flex-1 sm:flex-none`). Full-bleed sticky bars that use negative margins must match the responsive content padding (`-mx-2 px-2 sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6`). Keep tap targets ≥44px. Shared controls and table actions use at least 44px targets. `TabView`s with many tabs use `scrollable`.

PWA manifest, service-worker caching, and registration details live in §12.

### Forms

New and migrated forms use **React Hook Form + Zod** (`@hookform/resolvers/zod`):
```typescript
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { someSchema, type SomeFormData } from '@/lib/schemas/some.schema';

const { control, handleSubmit, formState: { errors } } = useForm<SomeFormData>({
  resolver: zodResolver(someSchema),
  defaultValues: { ... },
});
```
- Zod schemas live in `src/lib/schemas/`
- Controlled shared inputs use `Controller`; associate field errors with `aria-invalid` and `aria-describedby`
- Legacy forms may still use raw `useState` — migrate when touching them
- **Dialog forms submit on Enter**: wrap the fields in `<form onSubmit={useFormSubmit(save, { disabled })}>`
  (`src/lib/hooks/use-form-submit.ts`), make the primary button `type="submit"` and every
  other button `type="button"`. The hook commits a focused `[data-commit-on-submit]` numeric field by blurring it,
  then runs the latest `save` on the next tick. Test immediate click and Enter submission.
- **Partial updates**: an absent key keeps the stored value; to clear an optional field a form
  sends `null` (React drops `undefined` keys from server-action payloads). Actions map a
  present `null` to `undefined` with `clearNullsInPatch` (`src/lib/patch-utils.ts`), which the
  DB layer's `{ ...stored, ...patch }` merge then clears — see
  [`src/lib/actions/AGENTS.md`](../src/lib/actions/AGENTS.md).

### Dates, IDs, and salary calculations

Use `date-fns` for dates, `YYYY-MM` (`YearMonth`) for month values, `uuid.v4`
for entity IDs, and Finnish `fi-FI` display formatting through the shared helpers in
`src/lib/constants.ts`: `formatDate` ("27.9.2026"), `formatDateTime` ("27.9.2026 14.05")
and `formatDayMonth` ("15 March", optional `year`/`short`) — a bare `YYYY-MM-DD` is parsed
as a local date so the day never shifts through UTC. Use `calculateNetSalary`
from `src/lib/salary-utils.ts` rather than inline salary math. Taxed income uses
`calculateTaxedIncomeNet` from `src/lib/taxed-income-utils.ts`: salary taxes gross
plus taxable benefits; taxed income taxes raw gross. The DB freezes the taxed
net amount at write time, and the modal uses the same formula for its preview.

### Adding an entity

1. **Define types** in `src/types/index.ts` (entity + create/update request types)
2. **Create DB file** in `src/lib/db/` following the existing pattern (CRUD + file I/O)
3. **Add cached queries** in `src/lib/db/cached.ts`
4. **Create server actions** in `src/lib/actions/` with Zod validation and cache tags
5. **Create Zod schema** in `src/lib/schemas/` for form validation
6. **Add UI components** (modal form, list display) following existing patterns
7. **Update projection engine** if the entity affects financial projections
