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
│   │   ├── wealth/page.tsx                # Balance sheet / net worth
│   │   └── settings/page.tsx              # User preferences & admin panel
│   ├── layout.tsx                         # Root layout
│   └── page.tsx                           # Redirects to overview
├── components/
│   ├── charts/                            # ECharts and Chart.js components
│   ├── layout/                            # AppLayout, SidebarNav
│   ├── modals/                            # Entity create/edit modals
│   ├── onboarding/                        # Onboarding wizard
│   ├── providers/                         # Theme, PrimeReact, Session providers
│   ├── reconcile/                         # Reconciliation wizard
│   └── ui/                               # Shared UI (CommandPalette, EntityListDrawer, etc.)
├── lib/
│   ├── actions/                           # Server actions (all backend logic)
│   │   ├── accounts.ts                    # Cash account CRUD
│   │   ├── recurring.ts                   # Recurring income/expense CRUD
│   │   ├── planned.ts                     # One-off/repeating item CRUD
│   │   ├── salary.ts                      # Salary configuration CRUD
│   │   ├── investments.ts                 # Investment account CRUD + contributions
│   │   ├── debts.ts                       # Debt CRUD + reference rates + extra payments
│   │   ├── receivables.ts                 # Receivable CRUD + repayments
│   │   ├── taxed-income.ts                # Taxed income CRUD
│   │   ├── reconciliation.ts              # Balance snapshots, adjustments, sessions
│   │   ├── projection.ts                  # Cash flow projection action
│   │   ├── admin.ts                       # User management, app settings (admin only)
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
│   │   ├── users.ts                       # User file operations
│   │   ├── app-settings.ts                # App settings file operations
│   │   ├── user-preferences.ts            # Preferences file operations
│   │   └── cached.ts                      # Cached query wrappers
│   ├── auth.ts                            # NextAuth configuration
│   ├── projection.ts                      # Cash flow projection calculation engine
│   ├── wealth-projection.ts               # Net worth/wealth projection engine
│   ├── constants.ts                       # Currencies, frequencies, categories, formatters
│   └── proxy.ts                           # Reverse proxy utilities
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

export async function doSomething(input: SomeInput): Promise<ActionResult<SomeOutput>> {
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

**Return type**: `ActionResult<T>` = `{ success: boolean; data?: T; error?: string }`

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
- **Forms**: React Hook Form with Zod resolvers from `@hookform/resolvers`

### Date Handling

- **Library**: `date-fns` for all date operations
- **Format**: Year-month strings as `"YYYY-MM"` (type `YearMonth = string`)
- **Locale**: Finnish (`fi-FI`) for number formatting in `src/lib/constants.ts`

### ID Generation

- Use `uuid` package (`import { v4 as uuidv4 } from 'uuid'`) for all entity IDs

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
5. **Add UI components** (modal form, list display) following existing patterns
6. **Update projection engine** if the entity affects financial projections

## Adding a New Page

1. Create directory under `src/app/(dashboard)/` with `page.tsx`
2. Add navigation entry in `src/components/layout/sidebar-nav.tsx`
3. Add command palette entry in `src/components/ui/command-palette.tsx`

## Known Limitations

- **No test suite**: The project has no automated tests. Consider adding tests when making significant changes.
- **Race conditions**: File-based storage has no atomic operations or file locking. Concurrent write requests could cause data loss. Acceptable for single-user scenarios.
- **No cross-currency conversion**: Multi-currency is supported but currencies are not converted for aggregation — values in different currencies are summed as-is.
- **Hardcoded locale**: Number formatting uses `fi-FI` locale (Finnish) in `src/lib/constants.ts`.

## Known Bugs (Pending Fixes)

_No known bugs at this time._

## Development Commands

```bash
pnpm dev          # Start dev server (port 3999)
pnpm build        # Production build
pnpm lint         # Run ESLint
```
