# Sampolio Codebase Architecture Report

## Section 1: Project Map

```
sampolio/
├── .env.example, .env.local          # Environment config (ENCRYPTION_KEY, DATA_DIR, etc.)
├── .npmrc, .nvmrc                     # pnpm + Node version pinning
├── next.config.ts                     # Next.js 16 config (experimental dynamicIO, proxy rewrites)
├── package.json                       # pnpm, Next.js 16, PrimeReact, Tailwind v4
├── tsconfig.json                      # Strict TS, @/ path alias → src/
├── postcss.config.mjs                 # @tailwindcss/postcss plugin
├── eslint.config.mjs                  # Next.js ESLint config (flat config)
├── public/
│   └── themes/                        # PrimeReact prebuilt theme CSS (mdc-dark/light-deeppurple)
├── scripts/                           # macOS packaging: build-package.sh, launchd install/uninstall
├── dist/                              # Pre-built distribution zip
└── src/
    ├── app/
    │   ├── globals.css                # Tailwind v4 imports, PrimeReact CSS, dark mode overrides, typography
    │   ├── layout.tsx                 # Root: ThemeProvider > PrimeProvider > children
    │   ├── page.tsx                   # Root redirect: auth check → AppLayout > OverviewPage
    │   ├── api/auth/[...nextauth]/    # NextAuth v5 route handler (only API route)
    │   ├── auth/
    │   │   ├── layout.tsx             # Bare layout (no sidebar)
    │   │   ├── signin/page.tsx        # Sign-in form
    │   │   └── signup/page.tsx        # Sign-up form
    │   └── (dashboard)/               # Route group — all wrapped in AppLayout
    │       ├── layout.tsx             # AppLayout wrapper
    │       ├── overview/page.tsx      # Wealth dashboard (KPI cards, charts)
    │       ├── cashflow/page.tsx      # Monthly cashflow manager
    │       ├── wealth/page.tsx        # Net worth / balance sheet
    │       └── settings/page.tsx      # User prefs, admin panel
    ├── components/
    │   ├── charts/                    # 5 chart components (all ECharts)
    │   ├── layout/                    # AppLayout + SidebarNav
    │   ├── modals/                    # CashflowItemModal, OccurrenceOverrideDialog, UsersModal
    │   ├── onboarding/                # OnboardingWizard (5-step)
    │   ├── providers/                 # ThemeProvider, PrimeProvider
    │   ├── reconcile/                 # ReconcileWizard
    │   └── ui/                        # CommandPalette, EntityListDrawer, EntityModalRouter
    ├── lib/
    │   ├── actions/                   # 14 server action files
    │   ├── db/                        # 15 DB layer files (encrypted JSON file I/O + caching)
    │   ├── auth.ts                    # NextAuth v5 config
    │   ├── constants.ts               # Currencies, categories, formatters (fi-FI locale)
    │   ├── projection.ts              # Cashflow projection engine
    │   └── wealth-projection.ts       # Wealth/net-worth projection engine
    ├── proxy.ts                       # Custom server proxy utilities
    └── types/
        ├── index.ts                   # All type definitions (~739 lines)
        └── next-auth.d.ts            # Session type augmentation
```

## Section 2: Route & Layout Architecture

| Route | Page Component | Layout Chain | Key Features |
|---|---|---|---|
| `/` | `page.tsx` (redirects) | Root → AppLayout | Auth check, renders OverviewPage directly |
| `/auth/signin` | `signin/page.tsx` | Root → AuthLayout (bare) | Email/password form, no sidebar |
| `/auth/signup` | `signup/page.tsx` | Root → AuthLayout (bare) | Registration form, checks if signup enabled |
| `/overview` | `overview/page.tsx` | Root → Dashboard → AppLayout | KPI cards, wealth chart, entity drawer |
| `/cashflow` | `cashflow/page.tsx` | Root → Dashboard → AppLayout | Month strip, Sankey flow, waterfall, treemap, table |
| `/wealth` | `wealth/page.tsx` | Root → Dashboard → AppLayout | Net worth chart, breakdown, TabView |
| `/settings` | `settings/page.tsx` | Root → Dashboard → AppLayout | Prefs, categories, tax, admin panel |

**Layout hierarchy:**
- `RootLayout` → `ThemeProvider` → `PrimeProvider` → children
- `(dashboard)/layout.tsx` wraps children in `AppLayout`
- `AppLayout` provides: `SessionProvider`, `AppContext`, `SidebarNav`, `CommandPalette`, `EntityModalRouter`, `ReconcileWizard`, `OnboardingWizard`

**Modal/Dialog rendering pattern:**
All modals and drawers are rendered at the `AppLayout` level, triggered via `AppContext`:
- `openDrawer({ mode, entityType, entityId, yearMonth })` → routes through `EntityModalRouter`
- `EntityModalRouter` dispatches to: `CashflowItemModal` (income/expense/salary/planned), `EntityListDrawer` (accounts/investments/receivables/debts), or `UsersModal`
- `openReconcile()` → shows `ReconcileWizard`
- Onboarding auto-shows if `hasCompletedOnboarding === false`

**Navigation sidebar** (`sidebar-nav.tsx`):
3 nav items: Overview (`/`), Cashflow (`/cashflow`), Settings (`/settings`).
Note: **Wealth page has no sidebar entry** — it's only accessible via direct URL or command palette.

## Section 3: Component Catalog

### Layout Components
| Component | File | Purpose | Reusability |
|---|---|---|---|
| `AppLayout` | `components/layout/app-layout.tsx` | Main app shell — sidebar, content area, all global overlays | Singleton |
| `SidebarNav` | `components/layout/sidebar-nav.tsx` | Fixed sidebar with nav links, user menu, reconcile button | Singleton |

### Chart Components (all use ECharts via `echarts-for-react`)
| Component | File | Purpose | Data Source |
|---|---|---|---|
| `NetWorthChart` | `charts/net-worth-chart.tsx` | Single line chart of net worth over time | `WealthProjectionMonth[]` |
| `WealthChart` | `charts/wealth-chart.tsx` | Stacked area: cash, investments, receivables, debts | `WealthProjectionMonth[]` |
| `MonthlyFlowChart` | `charts/monthly-flow-chart.tsx` | Sankey diagram: income→budget→expenses | `MonthFlowData` |
| `CashflowWaterfallChart` | `charts/cashflow-waterfall-chart.tsx` | Waterfall: balance over months with income/expense bars | `MonthlyProjection[]` |
| `ExpenseTreemapChart` | `charts/expense-treemap-chart.tsx` | Treemap: expense breakdown by category | `ProjectionLineItem[]` |

### Modal Components
| Component | File | Purpose | Form Pattern |
|---|---|---|---|
| `CashflowItemModal` | `modals/cashflow-item-modal.tsx` (~850 lines) | Unified create/edit for recurring items, planned items, salary configs | useState + inline validation |
| `OccurrenceOverrideDialog` | `modals/occurrence-override-dialog.tsx` | Override single occurrence of a recurring item | useState |
| `UsersModal` | `modals/users-modal.tsx` | Admin user management CRUD | useState |

### UI Components
| Component | File | Purpose |
|---|---|---|
| `CommandPalette` | `ui/command-palette.tsx` | ⌘K palette — navigation, add income/expense, reconcile |
| `EntityListDrawer` | `ui/entity-list-drawer.tsx` (~1500 lines) | Sidebar drawer with full CRUD for investments, debts, receivables, accounts |
| `EntityModalRouter` | `ui/entity-modal-router.tsx` | Routes drawer state to correct modal/drawer component |

### Other Components
| Component | File | Purpose |
|---|---|---|
| `OnboardingWizard` | `onboarding/onboarding-wizard.tsx` | 5-step wizard: Welcome → Account → Income → Expenses → Done |
| `ReconcileWizard` | `reconcile/reconcile-wizard.tsx` | Multi-step: select month → enter actual balances → categorize variances → complete |
| `ThemeProvider` | `providers/theme-provider.tsx` | Dark/light theme via CSS class + PrimeReact theme CSS swap |
| `PrimeProvider` | `providers/prime-provider.tsx` | PrimeReact `PrimeReactProvider` with `ripple: true` |

### Form Pattern Analysis

**Current pattern:** All forms use **raw `useState`** — no React Hook Form or Zod on the client side. Zod validation exists only in server actions.

Examples:
- `CashflowItemModal`: ~15 useState hooks for form fields, manual validation on submit
- `OnboardingWizard`: Individual useState for each field (accountName, currency, grossSalary, etc.)
- `EntityListDrawer`: Separate form states for investment, debt, receivable create/edit forms

**Inconsistency note:** The CLAUDE.md mentions "React Hook Form with Zod resolvers" but **no component actually uses React Hook Form**. All forms are useState-based.

## Section 4: Data Model Reference

### Core Entities (from `src/types/index.ts`)

**FinancialAccount** — Cash account for cashflow tracking
- `id`, `userId`, `name`, `currency`, `startingBalance`, `startingDate`, `planningHorizonMonths`, `customEndDate?`, `isArchived`

**RecurringItem** — Monthly/quarterly/yearly income or expense
- `id`, `accountId`, `type` (income|expense), `name`, `amount`, `category?`, `frequency`, `customIntervalMonths?`, `startDate`, `endDate?`, `isActive`

**PlannedItem** — One-off or repeating planned item, also used for occurrence overrides
- `id`, `accountId`, `type`, `kind` (one-off|repeating), `name`, `amount`, `category?`, `scheduledDate?`, `frequency?`, `firstOccurrence?`, `endDate?`, `linkedRecurringItemId?`, `isRecurringOverride?`, `skipOccurrence?`

**SalaryConfig** — Detailed salary with tax/contributions/benefits
- `id`, `accountId`, `name`, `grossSalary`, `benefits[]`, `taxRate`, `contributionsRate`, `otherDeductions`, `netSalary` (computed), `isLinkedToRecurring`, `linkedRecurringItemId?`, `startDate`, `endDate?`, `isActive`

**SalaryBenefit** — Individual benefit within a salary
- `id`, `name`, `amount`, `isTaxable`

**InvestmentAccount** — Investment with growth model
- `id`, `userId`, `name`, `description?`, `currency`, `startingValuation`, `currentValuation?`, `valuationDate`, `annualGrowthRate`, `isArchived`

**InvestmentContribution** — One-off or recurring contribution/withdrawal
- `id`, `investmentAccountId`, `type` (contribution|withdrawal), `kind` (one-off|recurring), `amount`, `scheduledDate?`, `frequency?`, `startDate?`, `endDate?`, `isActive`

**Debt** — Amortized or fixed-installment liability
- `id`, `userId`, `name`, `description?`, `currency`, `debtType` (amortized|fixed-installment), `initialPrincipal`, `startDate`, `interestModelType` (none|fixed|variable), `fixedInterestRate?`, `referenceRateMargin?`, `monthlyPayment?`, `installmentAmount?`, `totalInstallments?`, `remainingInstallments?`, `linkedAccountId?`, `isArchived`, `endDate?`

**Receivable** — Loan to someone else
- `id`, `userId`, `name`, `description?`, `currency`, `initialPrincipal`, `currentBalance`, `hasInterest`, `annualInterestRate?`, `expectedMonthlyRepayment?`, `startDate`, `isArchived`

**TaxedIncome** — One-off or recurring taxed income (bonuses, etc.)
- `id`, `accountId`, `name`, `grossAmount`, `useSalaryTaxSettings`, `customTaxRate?`, `netAmount`, `taxAmount`, `contributionsAmount`, `kind`, `scheduledDate?`, `frequency?`, `isActive`

**UserPreferences** — Per-user settings
- `hasCompletedOnboarding`, `customCategories?`, `removedDefaultCategories?`, `taxDefaults?`, `updatedAt`

**Reconciliation types:** `BalanceSnapshot`, `ReconciliationAdjustment`, `ReconciliationSession`

**Projection types:** `MonthlyProjection`, `ProjectionLineItem`, `YearlyRollup`, `WealthProjectionMonth`, `DebtAmortizationRow`, `InvestmentProjectionRow`, `ReceivableProjectionRow`

## Section 5: Server Actions Map

| Action | File | Purpose | Cache Tags Invalidated |
|---|---|---|---|
| `getAccounts`, `createAccount`, `updateAccount`, `deleteAccount` | `actions/accounts.ts` | Cash account CRUD | `user:{id}:accounts` |
| `getRecurringItems`, `createRecurringItem`, `updateRecurringItem`, `deleteRecurringItem` | `actions/recurring.ts` | Recurring income/expense CRUD | `user:{id}:account:{aid}:recurring` |
| `getPlannedItems`, `createPlannedItem`, `updatePlannedItem`, `deletePlannedItem` | `actions/planned.ts` | One-off/repeating items + occurrence overrides | `user:{id}:account:{aid}:planned` |
| `getSalaryConfigs`, `createSalaryConfig`, `updateSalaryConfig`, `deleteSalaryConfig` | `actions/salary.ts` | Salary config CRUD (auto-creates linked recurring item) | `user:{id}:account:{aid}:salary` + `recurring` |
| `getInvestmentAccounts`, `createInvestmentAccount`, `updateInvestmentAccount`, `deleteInvestmentAccount`, `getContributions`, `createContribution`, `updateContribution`, `deleteContribution` | `actions/investments.ts` | Investment CRUD + contribution CRUD | `user:{id}:investments`, `investment:{id}:contributions` |
| `getDebts`, `createDebt`, `updateDebt`, `deleteDebt`, `getReferenceRates`, `addReferenceRate`, `deleteReferenceRate`, `getExtraPayments`, `addExtraPayment`, `deleteExtraPayment` | `actions/debts.ts` | Debt CRUD + rates + extra payments | `user:{id}:debts`, `debt:{id}:rates`, `debt:{id}:payments` |
| `getReceivables`, `createReceivable`, `updateReceivable`, `deleteReceivable`, `getRepayments`, `addRepayment`, `deleteRepayment` | `actions/receivables.ts` | Receivable CRUD + repayments | `user:{id}:receivables`, `receivable:{id}:repayments` |
| `getTaxedIncomes`, `createTaxedIncome`, `updateTaxedIncome`, `deleteTaxedIncome` | `actions/taxed-income.ts` | Taxed income CRUD | `user:{id}:account:{aid}:taxed-income` |
| `getReconciliationSessions`, `createReconciliationSession`, `getLatestCompletedSession`, `createBalanceSnapshot`, `createAdjustment`, `completeSession` | `actions/reconciliation.ts` | Reconciliation sessions + snapshots + adjustments | `user:{id}:reconciliation` |
| `getProjection` | `actions/projection.ts` | Compute cashflow projection for an account | None (read-only) |
| `getUserPreferences`, `completeOnboarding`, `updateCategories`, `updateTaxDefaults` | `actions/user-preferences.ts` | User preferences CRUD | `user:{id}:preferences` |
| `signUp`, `isSignupEnabled` | `actions/auth.ts` | Registration + signup check | `users` |
| `getSettings`, `updateSettings`, `listUsers`, `createUser`, `updateUser`, `deleteUser`, `revalidateAllCaches` | `actions/admin.ts` | Admin operations | `app-settings`, `users`, `all-data` |
| `getAppVersion` | `actions/app-info.ts` | Read version from package.json | None |

## Section 6: Projection Engine Analysis

### Cashflow Projection (`src/lib/projection.ts`)

**Step-by-step:**
1. `generateMonthList(account)` — Creates array of YYYY-MM strings from `startingDate` to `startingDate + planningHorizonMonths` (or `customEndDate`)
2. Separates `PlannedItem` into: override map (keyed by recurringItemId → yearMonth), one-off map (keyed by yearMonth), and repeating items
3. For each month:
   - Iterates `RecurringItem[]` — checks active, frequency alignment, applies override if exists (skip or amount/name change)
   - Collects one-off `PlannedItem[]` for this month
   - Collects repeating `PlannedItem[]` occurrences for this month
   - Applies category/type/kind filters
   - Sums income vs expenses, calculates net change and running balance
4. Returns `MonthlyProjection[]` with full income/expense breakdown per month

**Key observation:** The projection function is **pure** — it takes account + items and returns projections. No side effects. This is ideal for "what if" scenarios.

**Notable:** The projection currently does NOT include salary configs or taxed income. The `getProjection` server action only passes `recurringItems` and `plannedItems`. Salary configs are handled via their linked recurring item. Taxed income appears to be **not integrated into cashflow projection** — this is a gap.

### Wealth Projection (`src/lib/wealth-projection.ts`)

**Step-by-step:**
1. Pre-calculates individual projections:
   - `calculateInvestmentProjection()` — Monthly compound growth + contributions/withdrawals
   - `calculateReceivableProjection()` — Balance minus repayments + interest accrual
   - `calculateDebtAmortization()` — Standard amortization with variable rate support + extra payments
2. For each month in the range:
   - Looks up cash balance from `cashProjections` map (output of cashflow engine)
   - Looks up investment valuation from pre-calculated rows
   - Looks up receivable balance from pre-calculated rows
   - Looks up debt principal from pre-calculated rows
   - Net worth = cash + investments + receivables - debts
3. Returns `WealthProjectionMonth[]`

**Extension points for "What If":**
- Both engines accept data as parameters — no side effects, no persistence
- A "what if" scenario can be implemented by:
  1. Cloning the current data (accounts, items, investments, debts, etc.)
  2. Applying hypothetical modifications to the cloned data
  3. Passing modified data to `calculateProjection()` and `calculateWealthProjection()`
  4. Comparing original vs modified projections
- No new server actions needed for computation — it can run client-side or via a dedicated server action that accepts scenario parameters

## Section 7: Implementation Hooks

### Feature 1: "Am I okay?" Dashboard

**Files to modify:**
- `src/app/(dashboard)/overview/page.tsx` — Replace/supplement KPI grid with hero card
- `src/components/charts/wealth-chart.tsx` — May need simplified variant

**Files to create:**
- `src/components/ui/status-hero-card.tsx` — The "Am I okay?" card with status indicator

**Schema changes:** None — uses existing projection data

**Server action changes:** None — data already available from existing wealth projection

**Component changes:** New `StatusHeroCard` component. Overview page restructured to put hero card front-and-center, push KPI grid below (or show in Advanced mode only).

**Projection impact:** None — reads existing projection output

**Dependencies:** Ideally built after Feature 2 (Simple/Advanced mode) so Simple mode shows hero card, Advanced shows current layout

**Risk:** Low — purely additive UI change

---

### Feature 2: Simple vs Advanced Mode

**Files to modify:**
- `src/types/index.ts` — Add `displayMode` to `UserPreferences`
- `src/lib/db/user-preferences.ts` — Default value for new field
- `src/lib/actions/user-preferences.ts` — New `updateDisplayMode` action
- `src/app/(dashboard)/settings/page.tsx` — Add display mode toggle
- `src/components/layout/app-layout.tsx` — Expose display mode via `AppContext`
- Every page component that needs mode-aware rendering (overview, cashflow, wealth)

**Files to create:** None

**Schema changes:**
```typescript
interface UserPreferences {
  // ... existing
  displayMode?: 'simple' | 'advanced'; // default 'advanced' for backward compat
}
```

**Server action changes:**
- New `updateDisplayMode(mode)` in `actions/user-preferences.ts`

**Component changes:**
- `AppContext` gets `displayMode` field
- Pages wrap advanced-only sections in `{displayMode === 'advanced' && (...)}`
- Settings page gets a mode toggle

**Cache impact:** Uses existing `user:{id}:preferences` tag

**Dependencies:** None — but should be built early as other features (1, 3, 10) depend on it

**Risk:** Low — backward compatible with default 'advanced'

---

### Feature 3: Anxiety-aware Debt Presentation

**Files to modify:**
- `src/components/ui/entity-list-drawer.tsx` — Debt section: add progress bars, payoff date, friendlier labels
- `src/app/(dashboard)/wealth/page.tsx` — Debt cards with progress visualization
- `src/lib/wealth-projection.ts` — Add payoff date calculation utility

**Files to create:**
- `src/components/ui/debt-progress-card.tsx` — Reusable debt progress component

**Schema changes:** None — payoff date is derived from projection

**Server action changes:** None — data available from debt amortization projection

**Component changes:**
- New `DebtProgressCard` showing: progress bar (% paid off), estimated payoff date, monthly payment context
- In Simple mode: hide interest rates, amortization tables; show just progress + payoff date

**Projection impact:** Add utility `getDebtPayoffDate(amortizationRows)` to wealth-projection.ts

**Dependencies:** Feature 2 (Simple mode) for hiding jargon conditionally

**Risk:** Low

---

### Feature 4: Travel Reimbursement Tracking

**Files to modify:**
- `src/types/index.ts` — Add `isReimbursable?: boolean`, `reimbursementStatus?: 'pending' | 'received'` to `PlannedItem` and `RecurringItem`
- `src/lib/projection.ts` — When `isReimbursable && status === 'pending'`, project a future income for the reimbursement
- `src/components/modals/cashflow-item-modal.tsx` — Add reimbursement toggle
- Zod schemas in `actions/recurring.ts` and `actions/planned.ts`

**Files to create:** None

**Schema changes:**
```typescript
interface RecurringItem {
  // ... existing
  isReimbursable?: boolean;
  reimbursementStatus?: 'pending' | 'received';
}
interface PlannedItem {
  // ... existing  
  isReimbursable?: boolean;
  reimbursementStatus?: 'pending' | 'received';
}
```

**Server action changes:** Update Zod schemas in `recurring.ts` and `planned.ts` to accept new fields

**Projection impact:** Yes — `calculateProjection()` needs to generate a matching income item when an expense has `isReimbursable: true, reimbursementStatus: 'pending'`

**Cache impact:** No new tags

**Dependencies:** None

**Risk:** Medium — modifies the projection engine, which is central to the app. Needs careful handling of when reimbursement income appears (same month? next month? configurable delay?)

---

### Feature 5: Shared Expense Concept

**Files to modify:**
- `src/types/index.ts` — Add `isShared?: boolean`, `shareRatio?: number` (0-1, default 0.5) to `RecurringItem` and `PlannedItem`
- `src/lib/projection.ts` — When `isShared`, multiply expense amount by `shareRatio`
- `src/components/modals/cashflow-item-modal.tsx` — Add "Shared expense" toggle + ratio input
- Zod schemas in `actions/recurring.ts` and `actions/planned.ts`

**Schema changes:**
```typescript
interface RecurringItem {
  // ... existing
  isShared?: boolean;
  shareRatio?: number; // 0.5 = 50/50
}
```

**Projection impact:** Yes — `calculateProjection()` applies `amount * shareRatio` when `isShared`

**Dependencies:** None

**Risk:** Low-medium — simple multiplication in projection, but UI needs to clearly show "your share" vs "total"

---

### Feature 6: Guided Input Flows (Multi-step Wizard)

**Files to modify:**
- `src/components/modals/cashflow-item-modal.tsx` — Refactor into multi-step flow

**Files to create:**
- `src/components/wizards/add-item-wizard.tsx` — Multi-step guided flow
- Possibly individual step components

**Schema changes:** None — same data, different UX

**Server action changes:** None

**Component changes:** Major refactor of `CashflowItemModal` (~850 lines). The current modal shows all fields at once. A wizard would show:
1. What type? (income/expense)
2. Is it recurring or one-time?
3. Basic details (name, amount, category)
4. Schedule details (start date, frequency)
5. Advanced (reimbursable, shared, etc.)

**Dependencies:** Features 4 and 5 (reimbursement + shared) should ideally be built first so wizard includes those steps

**Risk:** High — `CashflowItemModal` is the most complex component. Consider building wizard alongside existing modal, not replacing it, so Advanced mode keeps the current form.

---

### Feature 7: Friendlier Reconciliation

**Files to modify:**
- `src/components/reconcile/reconcile-wizard.tsx` — Rename steps, add explanations, show inline deltas
- `src/app/(dashboard)/cashflow/page.tsx` — Show reconciliation status inline

**Files to create:** None

**Schema changes:** None — cosmetic changes

**Server action changes:** None

**Component changes:** ReconcileWizard UI overhaul:
- Rename "Balance Snapshot" → "What's your actual balance?"
- Add contextual help text explaining each step
- Show projected vs actual with visual delta (green/red bar)
- In Simple mode, hide adjustment categories, just show "Does this look right?"

**Dependencies:** Feature 2 (display mode)

**Risk:** Low — UI-only changes, no data model impact

---

### Feature 8: Goals Feature

**Files to modify:**
- `src/types/index.ts` — Add `Goal` interface
- `src/lib/db/cached.ts` — Add cached goal queries
- `src/app/(dashboard)/overview/page.tsx` — Display goal progress
- `src/components/layout/sidebar-nav.tsx` — Potentially add Goals nav item

**Files to create:**
- `src/lib/db/goals.ts` — Goal file operations
- `src/lib/actions/goals.ts` — Goal server actions
- `src/components/ui/goal-card.tsx` — Goal progress display
- `src/components/modals/goal-modal.tsx` — Goal create/edit form

**Schema changes:**
```typescript
interface Goal {
  id: string;
  userId: string;
  name: string;
  description?: string;
  targetAmount: number;
  currency: Currency;
  targetDate?: YearMonth;
  linkedAccountId?: string; // track progress from a cash account
  linkedInvestmentId?: string; // or an investment account
  createdAt: string;
  updatedAt: string;
}
```

**Server action changes:** Full CRUD: `getGoals`, `createGoal`, `updateGoal`, `deleteGoal`

**Projection impact:** Goal progress can be derived from existing projections — "by targetDate, account X will have Y, which is Z% of goal"

**Cache impact:** New tag `user:{id}:goals`

**Dependencies:** None for basic implementation. Richer if built after wealth projection is available to show cross-entity goal progress.

**Risk:** Medium — new entity type end-to-end, but follows established patterns exactly

---

### Feature 9: "What If?" Playground

**Files to modify:**
- `src/lib/projection.ts` — Already suitable (pure function)
- `src/lib/wealth-projection.ts` — Already suitable (pure function)
- `src/app/(dashboard)/overview/page.tsx` or new page

**Files to create:**
- `src/app/(dashboard)/playground/page.tsx` — Scenario playground page
- `src/components/playground/scenario-editor.tsx` — UI to modify parameters
- `src/components/playground/scenario-comparison.tsx` — Side-by-side comparison charts
- `src/components/layout/sidebar-nav.tsx` — Add nav entry

**Schema changes:** Optional — scenarios could be persisted:
```typescript
interface Scenario {
  id: string;
  userId: string;
  name: string;
  modifications: ScenarioModification[];
  createdAt: string;
}
interface ScenarioModification {
  type: 'add-item' | 'modify-item' | 'remove-item' | 'modify-account';
  entityType: string;
  entityId?: string;
  changes: Record<string, unknown>;
}
```

**Server action changes:**
- `runScenarioProjection(modifications)` — Takes current data + modifications, returns projection
- Optional: `saveScenario`, `getScenarios`, `deleteScenario`

**Projection impact:** The projection functions already work as pure functions. The key work is building the UI to let users express "what if I increased my salary by 500?" or "what if I paid off debt X early?"

**Dependencies:** Beneficial to have Features 4, 5 built first so scenarios can include reimbursements and shared expenses

**Risk:** High — Large UI surface area. The scenario editor needs to be intuitive. Consider starting with pre-built scenario templates ("What if I get a raise?", "What if I pay extra on my mortgage?") rather than a fully general editor.

---

### Feature 10: Cashflow View Simplification

**Files to modify:**
- `src/app/(dashboard)/cashflow/page.tsx` — Conditionally hide Sankey diagram, waterfall chart, and data table in Simple mode

**Files to create:** None

**Schema changes:** None — uses display mode from Feature 2

**Component changes:**
- Simple mode: Show only month strip + month details panel + simple bar chart
- Advanced mode: Full current layout with all charts and table

**Dependencies:** Feature 2 (display mode)

**Risk:** Low — conditional rendering only

---

## Section 8: Suggested Implementation Order

### Phase 1: Foundation (enables everything else)
1. **Feature 2: Simple vs Advanced Mode** — Minimal schema change, unlocks mode-aware rendering for all other features
2. **Feature 10: Cashflow View Simplification** — Quick win, demonstrates mode system working

### Phase 2: UX Quick Wins
3. **Feature 1: "Am I okay?" Dashboard** — High user impact, relatively small change
4. **Feature 7: Friendlier Reconciliation** — UI text/layout changes only
5. **Feature 3: Anxiety-aware Debt Presentation** — New component + utility, no schema changes

### Phase 3: Data Model Extensions
6. **Feature 5: Shared Expenses** — Simple schema addition + projection tweak
7. **Feature 4: Travel Reimbursement** — Schema + projection changes, slightly more complex
8. **Feature 8: Goals** — New entity type, follows established patterns

### Phase 4: Major Features
9. **Feature 6: Guided Input Flows** — Large refactor of CashflowItemModal, benefits from Features 4+5 being done
10. **Feature 9: "What If?" Playground** — Largest scope, benefits from all other features being stable

---

## Tech Debt & Inconsistencies

1. **React Hook Form not used:** CLAUDE.md claims RHF+Zod, but all forms use raw useState. Consider either updating the docs or migrating forms (especially for Feature 6).

2. **Wealth page not in navigation:** `sidebar-nav.tsx` has Overview, Cashflow, Settings — but no Wealth link. Users can only reach `/wealth` via the command palette.

3. **Taxed income not in projection:** `getProjection` server action only passes `recurringItems` and `plannedItems` to `calculateProjection()`. TaxedIncome entities exist in the DB but are not included in cashflow projection — they only appear in the CashflowItemModal list.

4. **Duplicate `calculateNetSalary`:** Exists in both `cashflow-item-modal.tsx` and `onboarding-wizard.tsx` with slightly different logic (taxable benefits handling differs). Should be extracted to a shared utility.

5. **Hardcoded EUR:** Wealth page defaults `displayCurrency` to `'EUR'`. Overview page hardcodes `'EUR'` in chart and KPI display. Multi-currency accounts will display incorrectly.

6. **No loading state on sidebar navigation:** Page transitions have no loading indicator.

7. **Serial fetching in Wealth page:** `fetchData()` in `wealth/page.tsx` does sequential awaits in for-loops rather than parallel Promise.all (unlike overview page which parallelizes).

8. **No test suite:** As documented — no tests exist.