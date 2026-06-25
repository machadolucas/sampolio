# Sampolio - AI Agent Instructions

Instructions for AI coding assistants working on this codebase.

## Project Overview

Sampolio is a self-hosted personal finance planning application. It tracks cash accounts, investments, debts, and receivables, then projects the user's financial future. Data is stored as encrypted JSON files on disk (no external database).

**Tech stack**: Next.js 16 (App Router), TypeScript (strict), PrimeReact, Tailwind CSS v4, NextAuth.js v5, Zod, React Hook Form, ECharts, date-fns.

**Package manager**: pnpm

## Directory Structure

```
src/
├── app/
│   ├── api/auth/[...nextauth]/route.ts   # NextAuth handler (only API route)
│   ├── auth/                              # Sign-in and sign-up pages
│   ├── (dashboard)/                       # Protected pages (route group)
│   │   ├── overview/page.tsx              # Wealth dashboard / home page
│   │   ├── cashflow/page.tsx              # Monthly cash flow management
│   │   ├── mortgage/page.tsx              # Shared mortgage ledger, charts, reconcile/import
│   │   ├── budgets/page.tsx               # Trip/project budgets list (+ [id]/page.tsx detail)
│   │   ├── playground/page.tsx            # "What If?" scenario explorer (ephemeral)
│   │   └── settings/page.tsx              # User preferences, admin panel & data maintenance
│   ├── layout.tsx                         # Root layout
│   └── page.tsx                           # Redirects to overview
├── components/
│   ├── charts/                            # ECharts and Chart.js components
│   ├── layout/                            # AppLayout, SidebarNav
│   ├── modals/                            # Entity create/edit modals (cashflow item, override, users)
│   ├── budgets/                           # Budget wizard, verdict card, coverage bars, expense log, dialogs
│   ├── mortgage/                          # Mortgage setup wizard, ledger table, charts, Sankey, reconcile/import dialogs
│   ├── onboarding/                        # Onboarding wizard
│   ├── providers/                         # Theme, PrimeReact, Session providers
│   ├── reconcile/                         # Reconciliation wizard
│   └── ui/                               # Shared UI (CommandPalette, EntityListDrawer, debt-progress-card, etc.)
├── lib/
│   ├── actions/                           # Server actions (all backend logic)
│   │   ├── accounts.ts                    # Cash account CRUD
│   │   ├── recurring.ts                   # Recurring income/expense CRUD
│   │   ├── planned.ts                     # One-off/repeating item CRUD + override cleanup
│   │   ├── salary.ts                      # Salary configuration CRUD
│   │   ├── investments.ts                 # Investment account CRUD + contributions
│   │   ├── debts.ts                       # Debt CRUD + reference rates + extra payments
│   │   ├── receivables.ts                 # Receivable CRUD + repayments
│   │   ├── taxed-income.ts                # Taxed income CRUD
│   │   ├── reconciliation.ts              # Balance snapshots, adjustments, sessions
│   │   ├── shared-mortgages.ts            # Shared mortgage CRUD + members/rates/costs/payments/snapshots
│   │   ├── budgets.ts                     # Trip/project budget CRUD + lines/funding/expense log + confirm/unconfirm
│   │   ├── goals.ts                       # Financial goal CRUD (backend-only; no UI yet)
│   │   ├── projection.ts                  # Cash flow projection action
│   │   ├── scenario.ts                    # "What If?" projection (ephemeral, never persisted)
│   │   ├── admin.ts                       # User management, app settings (admin only)
│   │   ├── maintenance.ts                 # History compaction preview/run (data pruning)
│   │   ├── auth.ts                        # Sign-up, signup-enabled check
│   │   ├── user-preferences.ts            # User preferences CRUD
│   │   └── app-info.ts                    # App version info
│   ├── db/                                # Database layer
│   │   ├── encryption.ts                  # AES-256-GCM encrypt/decrypt, file I/O
│   │   ├── accounts.ts                    # Account file operations
│   │   ├── recurring-items.ts             # Recurring item file operations
│   │   ├── planned-items.ts               # Planned item file operations
│   │   ├── salary-configs.ts              # Salary config file operations
│   │   ├── investments.ts                 # Investment file operations
│   │   ├── debts.ts                       # Debt file operations
│   │   ├── receivables.ts                 # Receivable file operations
│   │   ├── taxed-income.ts                # Taxed income file operations
│   │   ├── reconciliation.ts              # Reconciliation file operations
│   │   ├── budgets.ts                     # Budget file ops (one doc per budget, sub-entities embedded)
│   │   ├── goals.ts                       # Goal file operations
│   │   ├── shared-mortgages.ts            # Shared mortgage file ops (loans, members, rates, costs, payments, snapshots, actuals)
│   │   ├── users.ts                       # User file operations
│   │   ├── app-settings.ts               # App settings file operations
│   │   ├── user-preferences.ts            # Preferences file operations
│   │   └── cached.ts                      # Cached query wrappers
│   ├── schemas/                           # Zod form validation schemas
│   │   ├── auth.schema.ts                 # Sign-in / sign-up schemas
│   │   ├── mortgage.schema.ts             # Mortgage setup form schema
│   │   ├── budget.schema.ts               # Budget form schemas (details, line, funding, expense entry)
│   │   ├── goal.schema.ts                 # Goal form + action schemas
│   │   ├── recurring-item.schema.ts       # Recurring item schema
│   │   ├── planned-item.schema.ts         # Planned item schema
│   │   ├── salary-config.schema.ts        # Salary config schema
│   │   └── occurrence-override.schema.ts  # Override dialog schema
│   ├── auth.ts                            # NextAuth configuration
│   ├── projection.ts                      # Cash flow projection calculation engine
│   ├── wealth-projection.ts               # Net worth/wealth projection engine
│   ├── mortgage-projection.ts             # Shared mortgage amortization engine (dual loan, actual/360, annuity reset)
│   ├── mortgage-utils.ts                  # Pure mortgage helpers (loan-share derivation, Euribor-due detection)
│   ├── salary-utils.ts                    # Shared salary calculation utility
│   ├── budget-utils.ts                    # Pure budget engine (restricted-grant allocation, feasibility, transfers)
│   ├── budget-csv.ts                      # Grant-report CSV builders (spending log + summary)
│   ├── csv-utils.ts                       # Generic CSV build/download (semicolon + BOM, fi-FI Excel friendly)
│   ├── debt-utils.ts                      # Pure debt helper (payoff date/info from amortization)
│   ├── goal-utils.ts                      # Pure goal engine (progress vs. account/net-worth/manual)
│   ├── maintenance-utils.ts               # Pure history-compaction plan logic (anchor-gated, idempotent)
│   └── constants.ts                       # Currencies, frequencies, categories, formatters
├── proxy.ts                               # Next.js middleware (rate limiting + auth gating) — runs on the Edge runtime; security headers are in next.config.ts
├── test/
│   ├── setup.ts                           # Test setup (jest-dom matchers)
│   └── mocks.ts                           # Mock entity factories
└── types/
    ├── index.ts                           # All TypeScript type definitions
    └── next-auth.d.ts                     # NextAuth type augmentation
```

## Key Conventions

### Server Actions Pattern

All backend logic uses Next.js Server Actions. **There are no REST API routes** (except the NextAuth handler).

Every server action follows this pattern:
```typescript
'use server';

export async function doSomething(input: SomeInput): Promise<ApiResponse<SomeOutput>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Not authenticated' };

  // Validate with Zod
  const parsed = someSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message };

  // Perform operation
  const result = await dbOperation(session.user.id, parsed.data);

  // Invalidate cache
  updateTag(`user:${session.user.id}:entityType`);

  return { success: true, data: result };
}
```

**Return type**: `ApiResponse<T>` = `{ success: boolean; data?: T; error?: string }`

### Database Layer Pattern

Each entity type has a DB file in `src/lib/db/` that handles file I/O:
```typescript
// Pattern: read-modify-write with encrypted files
const dir = path.join(getUserDir(userId), 'entity-type');
await ensureDir(dir);
const filePath = path.join(dir, `${entityId}.enc`);
await writeEncryptedFile(filePath, entityData);
```

Key functions from `src/lib/db/encryption.ts`:
- `readEncryptedFile<T>(filePath)` — Read and decrypt JSON
- `writeEncryptedFile<T>(filePath, data)` — Encrypt and write JSON
- `getDataDir()` — Returns the data directory path
- `getUserDir(userId)` — Returns a user's data directory
- `ensureDir(dir)` — Creates directory recursively if needed

### Cache Invalidation

After any mutation, call `updateTag(tagName)` to invalidate cached queries. Common tags:
- `user:${userId}:accounts`
- `user:${userId}:recurring-items:${accountId}`
- `user:${userId}:debts`
- `user:${userId}:investments`
- `users` (admin operations)
- `app-settings`
- `all-data`

### UI Framework

- **Component library**: PrimeReact (not shadcn/ui or Material-UI)
  - Import from `primereact/button`, `primereact/inputtext`, etc.
  - Icons from `primeicons` and `react-icons`
- **Styling**: Tailwind CSS v4 utility classes
- **State management**: React Context (AppContext in `src/components/layout/app-layout.tsx`)
  - No Redux, Zustand, or other state libraries
  - Context provides: drawer state, selected account, refresh callbacks, sidebar state

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
- PrimeReact inputs require `Controller` wrapper (they use value/onChange, not ref-based)
- Legacy forms may still use raw `useState` — migrate when touching them

### Projection Engine

The cashflow projection engine (`src/lib/projection.ts`) calculates monthly projections for a single account:
```typescript
calculateProjection(account, recurringItems, plannedItems, taxedIncomes?, filters?, latestSnapshot?, mortgageTransfers?, budgetTransfers?)
```

- **TaxedIncome** items are included in projections using their `netAmount` (not `grossAmount`)
- **Occurrence overrides**: a single month of a recurring item is overridden by a `PlannedItem` flagged `isRecurringOverride` + `linkedRecurringItemId` (+ optional `skipOccurrence`), written by `upsertRecurringItemOccurrenceOverride`. The projection applies it in place of that month's recurring occurrence — it must **not** also be counted as a regular one-off (the DB layer persists those flags; dropping them re-introduces the duplication bug). Overrides older than 2 months before the projection start are excluded from the projection, and `cleanupExpiredOverrides` (auto-run after each override upsert/delete) deletes them, using the **anchor-based** cutoff so it never removes an override a projection still uses.
- The `cachedGetAccountProjectionData` batch function fetches all projection data in one cached call
- **Snapshot anchoring**: projections start from the *latest reconciliation snapshot* (its `yearMonth` + `actualBalance`) when one exists, falling back to the account's genesis `startingDate`/`startingBalance` otherwise. `resolveAnchor()` (in `projection.ts`) is the single helper for this; pass the latest snapshot (`cachedGetLatestSnapshot`) into `calculateProjection`. This is why forecasts stay correct after a monthly check-in **without** editing the account's start month. The same anchoring applies to investments/debts/receivables in `wealth-projection.ts` (debts negate the snapshot, which is stored negative). The horizon is measured from the anchor (rolling window).

### Shared Mortgage (the one multi-user / non-user-scoped entity)

Unlike every other entity (owned by one `userId` under `data/users/{id}/`), a **mortgage is shared** by a set of members and lives in a **global directory**:

```
data/shared/mortgages/{id}.enc                 # SharedMortgage (loans + members embedded)
data/shared/mortgages/{id}/rates|costs|extra-payments|snapshots/{id}.enc
data/shared/mortgage-members/{userId}.enc      # reverse index userId → mortgageIds
```

- The encryption key is **global**, so the shared dir is decryptable; **access control is enforced in the action layer** (`loadMortgageForMember` in `src/lib/actions/shared-mortgages.ts`) by checking `mortgage.members[].userId` against `session.user.id`. Add a partner by account email (`findUserByEmail`).
- **Cache tags are keyed by `mortgage:{id}`** (member-agnostic) so one `updateTag` reaches every member; only the membership list uses `user:{userId}:mortgages`.
- **Amortization engine** (`src/lib/mortgage-projection.ts`, pure): two+ sub-loans, each `interest = balance × rate × dayCountFraction` (actual/360); rate = most-recent Euribor entry + per-loan margin; `annuity-fixed-term` recomputes the level payment at each rate reset to hold maturity. Fees/insurance are **time-effective `MortgageCostEntry`** records (change from a month onward, history preserved). Drift snapshots are applied **inline** at their month (continuous history, re-anchored forward) — this differs from `resolveAnchor`, which discards pre-snapshot history. The schedule is emitted **from genesis** so the ledger shows full history.
- **Ownership identity** (reproduces the spreadsheet): `stake = initialPayment + loanShare × initialLoanTotal` (≈ half the house); `liability = loanShare × remainingTotal`; `equity = stake − liability`. Each member's **equity** folds into net worth in `wealth-projection.ts` (guarded by `mortgageProjections` + `currentUserId`, so existing callers are unaffected). Never also enter the mortgage as a `Debt` (double counting). `deriveLoanShares` (`src/lib/mortgage-utils.ts`) is the single source of truth for the share split — it derives each `loanSharePercent` precisely from the down payments + house price (`(½house − initialPayment)/loanTotal`, e.g. `133000/293000 = 0.45392…`), and that **full-precision** value is stored and used as-is. The monthly transfer is `loanSharePercent × totalCharge + serviceFee`; keep the precise fraction (don't round to e.g. 45.4%) so ownership converges to exactly 50/50 at payoff.
- **Cashflow integration**: each member optionally sets `MortgageMember.linkedAccountId` (their own cash account, via the members dialog → `setMyMortgageLinkedAccount`; not owner-gated since it only affects that member's private cashflow). When set, `getProjection` (`src/lib/actions/projection.ts`) runs the mortgage engine and injects that member's per-month `monthlyDeposit` into the linked account's `calculateProjection` as a **read-only `mortgage-payment` expense line** (`MortgageTransfer`). It tracks rate resets / reconciled actuals automatically, is **not** a stored entity, and clicking it in the cashflow UI deep-links to `/mortgage` (edits happen there, the single source of truth). A due **Euribor reminder** is also surfaced on the Overview page via `isEuriborUpdateDue`.

### Budgets (trip/project budgets with grant funding)

A **Budget** is a user-scoped, bounded-period plan (e.g. a 2-month research stay abroad): cost lines (one-off or monthly), funding sources (grants, per-diem allowances, other), and a dated expense log — all **embedded in one encrypted doc** at `data/users/{id}/budgets/{id}.enc` (single-user, single-page editing; one read/write, one cache tag `user:{userId}:budgets`).

- **Pure engine** (`src/lib/budget-utils.ts`): grants may be **restricted to categories** (`restrictedToCategories`); allocation is a deterministic greedy — most-constrained restricted grant first, by descending uncovered category cost; a restricted grant's surplus is **unusable** (reported, never netted against other categories or out-of-pocket). Unrestricted sources fill the rest. `computeFeasibility` yields `{totalCosts, usableFunding, outOfPocket, freeSurplus, perMonth[]}` — computed client-side on the budget page and server-side for injection. Per-diem sources store `amount = rate × days`, recomputed on save.
- **Cashflow integration** (the mortgage-transfer pattern): a budget with `status === 'confirmed' && !isArchived` and a `linkedAccountId` injects up to **2 aggregated read-only lines per month** (`source: 'budget'`, itemId = budgetId) via `getBudgetTransfersForAccount` in `src/lib/actions/projection.ts` → 8th param of `calculateProjection`. Clicking a line in cashflow deep-links to `/budgets/{id}`. `confirmBudget` requires a manual `exchangeRate` when budget currency ≠ account currency (e.g. SEK budget, EUR account); only confirm/unconfirm actions change `status`. Elapsed confirmed months naturally disappear behind the reconciliation anchor — no actual/forecast flip is needed.
- **Regular income** is pulled into the budget page **display-only** (existing `getProjection` with period filters, excluding `source === 'budget'` lines) — it never enters the out-of-pocket math and is never injected back, so there is no double counting by construction.
- **Expense log**: `BudgetExpenseEntry.date` is a plain `'YYYY-MM-DD'` string (month via `date.slice(0, 7)`, never `new Date()` parsing). Entries outside the period still count in rollups.
- **CSV export** (`src/lib/csv-utils.ts` + `budget-csv.ts`, the app's only export): semicolon delimiter + UTF-8 BOM + comma decimals so files open correctly in fi-FI Excel by double-click.
- Budget UI categories use the short plain-word `BUDGET_CATEGORIES` list (constants.ts), not `ITEM_CATEGORIES`.

### Goals (backend-only — no UI yet)

A **Goal** is a user-scoped financial target (e.g. "grow the emergency fund to €10k"), stored one-per-file at `data/users/{id}/goals/{id}.enc`. The full backend exists — server actions (`src/lib/actions/goals.ts`), DB layer (`src/lib/db/goals.ts`), cached queries (`cachedGetGoals` / `cachedGetGoalById`, tag `user:{userId}:goals`), Zod schema (`src/lib/schemas/goal.schema.ts`), and types (`Goal`, `CreateGoalRequest`, `UpdateGoalRequest`) — **but it is not surfaced in any page, component, sidebar, or command-palette entry**. Treat it as plumbing ready for a UI.

- **Tracking methods** (`trackingMethod`): `'manual'` (user sets `currentManualAmount`), `'account-balance'` (progress = projected balance of `linkedAccountId`), or `'net-worth'` (progress = net-worth projection).
- **Pure engine** (`src/lib/goal-utils.ts`): `calculateGoalProgress(goal, cashProjections?, wealthProjections?)` returns `{ currentAmount, targetAmount, percentComplete (capped 100), projectedAmountAtTarget, onTrack, projectedDate }`. Goals **read** projections; they never feed back into the cashflow/wealth engines (a pure monitoring layer).
- `targetDate` is a `YYYY-MM` string. Goals are archivable (`isArchived`), and `getGoals` returns them sorted by name.

### Scenarios / "What If?" Playground (ephemeral — never persisted)

The `/playground` page ("What If?" in the sidebar, `MdExplore` icon) lets the user model a hypothetical change to one account and see the projected end-balance delta. There is **no stored entity and no cache tag** — `runScenarioProjection` (`src/lib/actions/scenario.ts`) reads the live cached projection inputs, clones the recurring/planned arrays, applies the requested modification, and runs `calculateProjection` twice (current vs. modified), returning a `ScenarioResult` (`{ current, modified, summary }`) held only in memory.

- **Modification types**: `'add-income'`, `'add-expense'`, `'remove-item'`, `'modify-amount'`. The action accepts an array of mods (the UI currently sends one). Synthetic items get throwaway IDs (`scenario-…`) so they never collide with real data.
- The modified projection inherits all real engine behavior (mortgage/budget transfers, taxes, overrides, anchoring), so the delta is directly comparable.

### Date Handling

- **Library**: `date-fns` for all date operations
- **Format**: Year-month strings as `"YYYY-MM"` (type `YearMonth = string`)
- **Locale**: Finnish (`fi-FI`) for number formatting in `src/lib/constants.ts`

### ID Generation

- Use `uuid` package (`import { v4 as uuidv4 } from 'uuid'`) for all entity IDs

### Salary Calculation

Use `calculateNetSalary` from `src/lib/salary-utils.ts` — the single canonical implementation. Do NOT define salary calculation inline in components.

### Type Definitions

All types are centralized in `src/types/index.ts`. Key types:
- `FinancialAccount`, `RecurringItem`, `PlannedItem`, `SalaryConfig`
- `InvestmentAccount`, `InvestmentContribution`
- `Debt`, `DebtReferenceRate`, `DebtExtraPayment`
- `Receivable`, `ReceivableRepayment`
- `TaxedIncome`
- `BalanceSnapshot`, `ReconciliationAdjustment`, `ReconciliationSession`
- `MonthlyProjection`, `WealthProjectionMonth`
- Request types: `Create*Request`, `Update*Request`

## Adding a New Entity Type

1. **Define types** in `src/types/index.ts` (entity + create/update request types)
2. **Create DB file** in `src/lib/db/` following the existing pattern (CRUD + file I/O)
3. **Add cached queries** in `src/lib/db/cached.ts`
4. **Create server actions** in `src/lib/actions/` with Zod validation and cache tags
5. **Create Zod schema** in `src/lib/schemas/` for form validation
6. **Add UI components** (modal form, list display) following existing patterns
7. **Update projection engine** if the entity affects financial projections

## Adding a New Page

1. Create directory under `src/app/(dashboard)/` with `page.tsx`
2. Add navigation entry in `src/components/layout/sidebar-nav.tsx`
3. Add command palette entry in `src/components/ui/command-palette.tsx`

## Known Limitations

- **Race conditions**: File-based storage has no atomic operations or file locking. Concurrent write requests could cause data loss. Acceptable for single-user scenarios.
- **No cross-currency conversion**: Multi-currency is supported but currencies are not converted for aggregation — values in different currencies are summed as-is. Aggregate displays use the primary account's currency with a "(mixed currencies)" note when applicable.
- **Hardcoded locale**: Number formatting uses `fi-FI` locale (Finnish) in `src/lib/constants.ts`.
- **Shared mortgage concurrency**: Shared mortgages have no file locking either; concurrent edits by two members can clobber. Acceptable for a small household.
- **Mortgage auto-amortization is a model**: With zero data entry the engine tracks the real bank balance within ~0.5% (validated against a 41-month schedule). The residual comes from the bank's irregular early payments (e.g. an interest-only start) that a level annuity can't reproduce. For an **exact (zero-delta) match**, record the actual monthly history: `MortgageActualEntry` rows (per loan: remaining, repayment [= the bank's full charge, incl. insurance + invoicing share], interest [after subsidy], insurance, **subsidy**) are used verbatim by the engine for recorded months — the projection resumes from the latest actual. Two ways to record: the **per-month reconcile** flow (the everyday path — a "Reconcile <month>" button + a per-row ✓ on each elapsed forecast open `mortgage-reconcile-dialog.tsx`, prefilled with the projected figures; confirm flips that month forecast→actual via `reconcileMortgageMonth`, and the ↩ on an actual row reverts it via `revertMortgageMonth`/`deleteActualsForMonth`), or the bulk **"Import actual history" CSV/paste dialog** (`mortgage-import-dialog.tsx`, optional 7th `subsidy` column). The ledger marks **actual** vs **forecast** rows and shows an **ASP subsidy** column whenever a subsidy-enabled ASP loan exists. **Forecast carry-forward**: each actual sets `levelPayment = scheduledPayment`, so forecasts beyond the last actual hold the bank's current P+I installment (constant `monthlyCharge`) until the next Euribor reset re-annuitizes it — they do *not* drift down. See the "reproduces the spreadsheet EXACTLY" tests in `src/lib/mortgage-projection.test.ts` (max delta €0.00). The lighter **drift adjustment** still exists for a single-point re-anchor.
- **Euribor effective month**: a reset takes effect on payments only after the bank's notice period — e.g. a mid-December fixing applies to payments from ~February. Enter each rate's "effective from" month accordingly (the Euribor dialog lets you pick it); the engine applies a rate from its `effectiveDate` month, with no built-in lag.
- **Data retention / growth**: reconciliation snapshots, sessions and adjustments accumulate over time but are individually tiny encrypted files, and projections only ever read the **latest snapshot per entity** (the anchor) — so older history is dead weight, never wrong. Users can prune it from **Settings → Data & storage** (`previewHistoryCompaction` / `compactHistory` in `src/lib/actions/maintenance.ts`; pure plan logic in `src/lib/maintenance-utils.ts`). Compaction keeps the latest snapshot per entity + sessions at/after the latest reconciliation month, drops orphaned adjustments, and **never touches mortgage data** (the engine needs `actuals` + drift snapshots from genesis). It is anchor-gated and idempotent, so a projection is byte-identical before and after (asserted in `maintenance-utils.test.ts`).

## Known Bugs (Pending Fixes)

_No known bugs at this time._

## Development Commands

```bash
pnpm dev          # Start dev server (port 3999)
pnpm build        # Production build
pnpm lint         # Run ESLint
pnpm test         # Run tests (vitest)
pnpm test:watch   # Run tests in watch mode
pnpm test:coverage # Run tests with coverage
```

## Testing With a Copy of Production Data

The maintainer's **production data lives at `~/.sampolio/data`** (primary user `machadolucas@me.com`). **Never edit, move, or write back to `~/.sampolio/data`** — it is the live, irreplaceable copy. To exercise the app against real data, work on a **copy** inside the repo at `./data` (the whole `/data` dir is gitignored, so the copy and its secrets are never committed):

```bash
# One-time: copy prod data (incl. the dot-file secrets) into the repo. Trailing
# slashes + -a preserve hidden files. NEVER run this the other direction.
rsync -a ~/.sampolio/data/ ./data/
```

The data directory carries its own secrets as dot-files (the app reads them from the environment, not from disk, so they must be injected):
- `data/.encryption_key` — `ENCRYPTION_KEY` (AES-256-GCM key; decrypts every `.enc` file)
- `data/.auth_secret` — `AUTH_SECRET` (NextAuth)
- `data/.auth_url` — the prod `AUTH_URL` (use `http://localhost:4999` locally instead)

**Port 3999 is taken by production**: the launchd service `com.sampolio.app` (`~/Library/LaunchAgents/com.sampolio.app.plist`, KeepAlive) runs `next start -p 3999` from this very repo against the live `~/.sampolio/data` — do not kill it (launchd restarts it) and never point a dev server at its port or data. The dev preview therefore runs on **port 4999**. Prod and dev share this one clone but **not the Next.js build dir**: prod sets `NEXT_DIST_DIR=.next-prod` (in the plist + deploy scripts) while the dev preview leaves it unset (→ `.next`), so `next dev` can't clobber the build `next start` serves (`distDir` in `next.config.ts`). The dev preview writing `.next/` therefore never endangers prod.

**Run the dev server on the copy** via the `sampolio-preview` config in `.claude/launch.json`, which exports those env vars from the dot-files, points `DATA_DIR` at `./data`, and enables the dev auth bypass:

```jsonc
// .claude/launch.json → runtimeArgs (sh -c):
export ENCRYPTION_KEY=$(cat data/.encryption_key);
export AUTH_SECRET=$(cat data/.auth_secret);
export AUTH_URL=http://localhost:4999;
export DATA_DIR=$PWD/data;
export DEV_AUTH_BYPASS=machadolucas@me.com;   // dev-only sign-in bypass
exec ./node_modules/.bin/next dev -p 4999
```

- **`DEV_AUTH_BYPASS`** + visiting **`/dev-login`** signs you in as that user with no password (dev only). The bypass user must already exist in the data — it does in a prod copy; for an empty `./data` you'd have to create it first.
- Verify in the browser with the `preview_*` tools (`preview_start sampolio-preview`, then `preview_eval`/`preview_screenshot`). The preview page can drift back to `/` between calls — re-navigate inside a single eval and rely on screenshots as the source of truth.
- To re-seed mortgage actuals from the spreadsheet, regenerate `actuals.csv` from `Mortgage.numbers` (a Python `numbers-parser` venv) and re-import via the "Import actual history" dialog with *Replace all* checked. Keep the original six columns byte-identical; only the `subsidy` column is new.

**Deploying to prod** (same machine, from this repo): use the **`/deploy-prod` skill** (`.claude/skills/deploy-prod/`). It snapshots `~/.sampolio/data`, runs `pnpm lint`/`pnpm test`, builds into `.next-prod`, asks for explicit confirmation, then restarts `com.sampolio.app` and health-checks (localhost:3999 + `https://sampolio.machadolucas.me`). It never auto-runs and never restarts prod before you confirm. See `~/claude/docs/sampolio.md` for the full runbook.
