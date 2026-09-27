# Server Actions (`src/lib/actions/`)

All backend logic for the application. There are **no REST API routes** — everything uses Next.js Server Actions.

## Architecture

Every action file starts with `'use server'` and exports async functions. The consistent pattern is:

1. **Authenticate**: `const session = await auth()` — reject if no session
2. **Validate**: Use Zod schema to parse input
3. **Execute**: Call DB layer functions from `src/lib/db/`
4. **Invalidate cache**: Call `updateTag(tagName)` for affected data
5. **Return**: `ApiResponse<T>` = `{ success: boolean; data?: T; error?: string }`

Ids that become path segments are validated at the boundary with `idSchema` /
`yearMonthSchema` / `chunkMonthSchema` (`src/lib/schemas/id.schema.ts`); the DB layer
re-checks them (`src/lib/db/AGENTS.md`).

### Partial updates: absent keeps, `null` clears

Update schemas accept `null` on optional fields as the explicit "clear this field"
signal, because React drops `undefined` keys from server-action payloads (a form that
sends `undefined` would silently keep the old value). After parsing, map the present
nulls with `clearNullsInPatch(patch, keys)` (`src/lib/patch-utils.ts`): a present `null`
becomes `undefined`, which the DB layer's `{ ...stored, ...patch }` merge then clears,
while an absent key stays absent so a toggle-only patch (`{ isActive: false }`) never
clears unrelated fields. Used by `accounts.ts`, `recurring.ts`, `planned.ts`,
`salary.ts`, and `taxed-income.ts` (a cleared custom rate makes the DB layer recompute the
frozen net). Covered by `partial-updates.test.ts`.

## Action Files

| File | Entity | Operations |
|------|--------|------------|
| `accounts.ts` | Cash accounts | CRUD |
| `recurring.ts` | Recurring income/expenses | CRUD (scoped to account) |
| `planned.ts` | One-off/repeating items | CRUD (scoped to account) |
| `salary.ts` | Salary configurations | CRUD (scoped to account); every mutation also invalidates the account's `recurring` tag (the linked `Salary: {name}` recurring item is written by the DB layer); create/update/delete cascade-recompute salary-linked taxed incomes (`recomputeSalaryLinkedTaxedIncomes`, invalidating the `taxed-income` tag when rows changed) |
| `investments.ts` | Investment accounts | CRUD + contribution/withdrawal management (contribution writes also invalidate `user:{userId}:investments`, whose batch read embeds them) |
| `debts.ts` | Debts/liabilities | CRUD + reference rates + extra payments (child writes also invalidate `user:{userId}:debts`) |
| `receivables.ts` | Receivables | CRUD + repayment recording |
| `taxed-income.ts` | Bonuses/holiday pay | CRUD (scoped to account) |
| `reconciliation.ts` | Balance verification | Snapshots, adjustments, sessions; `applyReconciliationBalances` writes confirmed balances into entity fields and stores a debt's pre-check-in `initialPrincipal` once as `originalPrincipal` |
| `shared-mortgages.ts` | Shared mortgages | CRUD + members/rates/costs/payments/snapshots/actuals (member-scoped, not user-scoped). `loadMortgageForMember` rejects an unsafe mortgage id; actions taking a positional sub-id (rate, cost, payment, snapshot, linked account) answer "… not found" for an unsafe one, and `guarded()` turns any thrown I/O or `UnsafePathError` into an `ApiResponse` error |
| `budgets.ts` | Trip/project budgets | CRUD + lines/funding/expense log + confirm/unconfirm. Per-diem funding sources may carry `linkedTripId` (EUR-only budget; one budget per trip — validated in `resolveTripLinkedAmount`); reads hydrate the amount from the trip's live per-diem via `hydrateBudgetFundingFromTrips` |
| `goals.ts` | Financial goals | CRUD (UI at `/goals`) |
| `trips.ts` | Trips (Vero.fi per diem) | CRUD (UI on the merged `/budgets` page; `/trips` redirects) |
| `data-transfer.ts` | JSON backup | `exportUserData` (all user-scoped entities incl. trips, one envelope at `EXPORT_VERSION` 2, read fresh from disk via `readUserDataForExport` — never the cached readers) / `importUserData` (merge or replace; never touches bank data). Import validates the whole payload (`dataExportSchema`: domain rows, row caps, trips) and rejects it naming the failing path; a v1 payload (no `trips`) imports with a warning, restores no trips and never deletes `trips/` even in replace mode (`ImportCounts.trips: null`); responses carry `warnings[]` |
| `split-groups.ts` | Split groups (Splitwise replacement) | CRUD + members/expenses/settle-up/recurrence + `updateSplitGroupMemberRole` (owner-gated, refuses demoting the last owner, checked under the group lock) + `removeSplitGroupMember` (owner-gated) / `leaveSplitGroup` (any member) sharing `removeMemberLocked` (uncached re-read under the lock; refuses a non-zero net or the last owner) + generic `MEMBER_LOOKUP_ERROR` for any failed email lookup in `createSplitGroup`/`addSplitGroupMember` + `updateSplitExpense`/`deleteSplitExpense` with an optional `monthHint` (the row's current `YYYY-MM`, ignored unless it passes `chunkMonthSchema`) + CSV import + `catchUpGroupRecurrences` (re-reads the group uncached inside the lock; `onePerMonth` guard for monthly/yearly rules; notifies only created rows; returns `{ generated, changed }` — `changed` whenever any occurrence was written, i.e. callers should re-read) + `getMySplitNetBalance` + `getMySplitLinkCandidates` (read-only projection for the bank ledger's exact/heuristic/recovered matching; preserves requested months and reads adjacent month candidates) + `confirmSplitBankLink` (authenticated ownership-checked suggestion confirmation) + `getSplitInsights` (read-only /split summary + spend/net charts, via the pure `split-insights.ts`) + `markSplitGroupSeen` (membership-checked, monotonic per-group seen-watermark into `UserPreferences.splitLastSeenAt`) (member-scoped, not user-scoped; per-group in-process mutex around every group, member, rule and expense write; `invalidateGroup` passes the chunk months a write touched, or `allMonths` for bulk writes; integer cents. Bank-backed creation validates canonical server transaction metadata, returns duplicate details for explicit acknowledgement, and checks duplicates inside the mutex. `updateSplitRecurrenceRule` prunes an end-dated rule's generated tail inside one `withGroupLock`, then runs `catchUpGroupRecurrences` OUTSIDE it — the mutex is non-reentrant). Every mutating action also calls `notifySplitActivity` (`src/lib/split-notify.ts`) after its write + `invalidateGroup`: `createSplitExpense`/`quickAddSplitExpense` ⇒ `expense.created`, `updateSplitExpense` ⇒ `expense.updated`, `confirmSplitBankLink` ⇒ `expense.updated` only when the link changes, `deleteSplitExpense` ⇒ `expense.deleted` (pre-reads the row via `getExpenseById`; payment rows notify nothing), `recordSettleUp` ⇒ `payment.recorded`, `catchUpGroupRecurrences` ⇒ one `expense.generated` per generated row (author = the rule's payer). The call only *schedules* the POST (`after()`), so it is safe inside `withGroupLock` and can never fail or delay the mutation |
| `projection.ts` | Cash flow projection | `getProjection(accountId, filters?)` only — Zod-validates the id (`idSchema`) and filters (`startDate`/`endDate` as `yearMonthSchema`, categories, item types/kinds), then calls `computeAccountProjection` (`src/lib/account-projection.ts`, server-only plain module shared with `dashboard-data.ts`). The response carries `monthly`, `retrospective`, `categories`, `salaryConfigs`, `taxedIncomes` and an account summary — no yearly rollups. Input gathering + transfer helpers live in `src/lib/projection-inputs.ts`, shared with scenarios — plain server module, NOT 'use server', so the userId-taking helpers are never client-invokable; bank reads go through a per-request memoized `BankDataLoader` (`createBankDataLoader`) |
| `dashboard-data.ts` | Page aggregates (read-only) | `getOverviewData`, `getHomeData`, `getGoalsPageData` — one round trip per page instead of dozens of serial actions (Next runs client-invoked actions one at a time). Each authenticates once, rejects any argument (`z.tuple([])`), fans out in parallel over the cached readers and shared helpers (`gatherWealthInputs` in `src/lib/wealth-inputs.ts`, `computeAccountProjection`, reused read actions), and returns one `ApiResponse`. Overview's wealth inputs are **required** (a failed part fails the action, naming it via `WealthInputError.part`); reminders, Home's parts and the Home glance are non-critical and fall back (logged). No mutations and no tags of their own — pages call them again after a mutation. Split recurrence catch-up stays a separate client call (it mutates) |
| `scenario.ts` | "What If?" projection | Read-only, ephemeral — never persisted. Same inputs/transfers/card-exclusion as `getProjection` (absolute balances match the cashflow page); card bills recomputed from the modified item lists |
| `bank.ts` | Bank sync (Enable Banking, PSD2 AIS) | Connect/reconnect/refresh, link config, card billing/liabilities, recurring-transaction suggestions (`getRecurringSuggestions`, on-demand from cached reads), Home balance glance (`getHomeBankGlance`: non-excluded links with a transaction in the last 30 days — the link's `syncCursor.lastBookingDate` answers without decoding the ledger, else a ledger scan by `txDisplayDate`; cards via `effectiveCardNumbers`; labels never expose raw IBANs) — **read-only**; hard-disables when unconfigured |
| `euribor.ts` | Euribor prefill | `fetchCurrentEuribor12m` — ECB Data Portal fetch (5s timeout, 6h in-memory TTL, always-graceful failure); prefills the mortgage Euribor dialog, never auto-applies |
| `admin.ts` | Users & app settings | User CRUD (passwords validated with `passwordPolicySchema`; rows carry `passkeyCount`; deactivate/password reset revoke sessions, keep passkeys; delete = soft delete), `listUserPasskeys`, `removeUserPasskeys` (explicit "Remove passkeys"), settings (admin only, re-checked from the DB) |
| `maintenance.ts` | Data maintenance | History compaction preview/run from **uncached** reads: prunes non-latest snapshots, orphaned adjustments, older sessions and expired occurrence overrides (`HistoryCompactionStats.overrides`; cutoff `expiredOverrideCutoff`, shared with `planned.ts`'s `cleanupExpiredOverrides`) |
| `auth.ts` | Authentication | `signUp` (Better Auth `signUpEmail`; gating/policy enforced in the auth hooks; signs the user in via `nextCookies`), `checkSignupEnabled` |
| `account.ts` | Account self-service | `changeMyPassword` (Better Auth `changePassword`: re-verifies the current password, scrypt, revokes other sessions, keeps passkeys), `listMyPasskeys`, `getAccountDeletionPreflight`, `deleteMyAccount` (email-typed confirm; re-runs the preflight server-side on uncached reads; then shared entities first — each split group re-checked under `withGroupLock` (net €0, not the last owner, deleted only when the user is its sole member on disk, else left), each mortgage re-read before removal — and only then bank teardown + `hardDeleteUser`), `resetMyData` ("start fresh": bank teardown + wipe owned data dirs, keeps user.enc/preferences.enc) — `deleteMyAccount` and `resetMyData` both require a session younger than 10 minutes (`requireRecentSignIn`), `updateMyAvatar` (data-URI or null → `setUserAvatar`, bumps `avatarVersion`) — all session-scoped, none accept a userId |
| `user-preferences.ts` | User preferences | Read/update preferences (categories, display mode, tax defaults, check-in reminders/notifications, `updateBankAccountOrder` — bank-link display order, and `updateSplitGroupOrder` — split-group display order, both sanitized against current ids). `updateBottomNavIds` stores the mobile bottom-nav tabs (`bottomNavIds`: 1–4 `NavigationPage` ids validated with `z.enum(NAVIGATION_PAGE_IDS)` from the plain `@/lib/bottom-nav-prefs`, deduped; `null` writes `undefined` so the key is dropped and the per-display-mode defaults apply again). `updateSplitNotificationPrefs` stores the five-key `splitNotificationPrefs` opt-out record wholesale (the UI always sends all five; absent key ⇒ notifications on); `getSplitNotifyStatus` reports whether the server has the Home Assistant webhook configured (`getSplitNotifyConfig() !== null`, mirroring `getBankFeatureStatus`) |
| `user-profiles.ts` | User profiles (display) | `getUserProfiles(userIds)` → `{ id, name, avatarUrl? }` for any authenticated user (no email/role — safe for cross-user member/actor displays) |
| `app-info.ts` | App metadata | Version info |

## Cache Tags

After mutations, invalidate the appropriate cache tag:

```
user:{userId}:accounts
user:{userId}:account:{accountId}:recurring
user:{userId}:account:{accountId}:planned
user:{userId}:account:{accountId}:salary
user:{userId}:account:{accountId}:taxed-income
user:{userId}:investments
user:{userId}:debts
user:{userId}:receivables
user:{userId}:reconciliation
user:{userId}:budgets
user:{userId}:goals
user:{userId}:trips
user:{userId}:mortgages        (a member's mortgage membership list)
mortgage:{mortgageId}          (member-agnostic; one updateTag reaches every member)
user:{userId}:split-groups     (a member's split-group membership list)
split-group:{groupId}          (member-agnostic doc) + :summary (running balances) + :expenses (whole-history readers)
split-group:{groupId}:expenses:{YYYY-MM}   (one month chunk)  + :expense-chunks (every month — bulk writes)
user:{userId}:bank-connections
user:{userId}:bank-connection:{connectionId}                       (+ :runs for its sync-run log)
user:{userId}:bank-account:{linkedAccountId}:transactions
users                          (admin operations)
app-settings                   (admin operations)
all-data                       (admin cache clear)
```

> Scenarios (`scenario.ts`), projections (`projection.ts`) and the page aggregates (`dashboard-data.ts`) are read-only and use **no** tags of their own.

## Adding a New Server Action

1. Create file in this directory with `'use server'` at top
2. Define Zod schema for input validation
3. Follow the authenticate → validate → execute → invalidate → return pattern
4. Add cached query wrapper in `src/lib/db/cached.ts` if data is read frequently
5. Use descriptive cache tags following the `user:{userId}:entity-type` pattern
