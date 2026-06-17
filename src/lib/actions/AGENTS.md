# Server Actions (`src/lib/actions/`)

All backend logic for the application. There are **no REST API routes** — everything uses Next.js Server Actions.

## Architecture

Every action file starts with `'use server'` and exports async functions. The consistent pattern is:

1. **Authenticate**: `const session = await auth()` — reject if no session
2. **Validate**: Use Zod schema to parse input
3. **Execute**: Call DB layer functions from `src/lib/db/`
4. **Invalidate cache**: Call `updateTag(tagName)` for affected data
5. **Return**: `ApiResponse<T>` = `{ success: boolean; data?: T; error?: string }`

## Action Files

| File | Entity | Operations |
|------|--------|------------|
| `accounts.ts` | Cash accounts | CRUD |
| `recurring.ts` | Recurring income/expenses | CRUD (scoped to account) |
| `planned.ts` | One-off/repeating items | CRUD (scoped to account) |
| `salary.ts` | Salary configurations | CRUD (scoped to account) |
| `investments.ts` | Investment accounts | CRUD + contribution/withdrawal management |
| `debts.ts` | Debts/liabilities | CRUD + reference rates + extra payments |
| `receivables.ts` | Receivables | CRUD + repayment recording |
| `taxed-income.ts` | Bonuses/holiday pay | CRUD (scoped to account) |
| `reconciliation.ts` | Balance verification | Snapshots, adjustments, sessions |
| `shared-mortgages.ts` | Shared mortgages | CRUD + members/rates/costs/payments/snapshots/actuals (member-scoped, not user-scoped) |
| `budgets.ts` | Trip/project budgets | CRUD + lines/funding/expense log + confirm/unconfirm |
| `goals.ts` | Financial goals | CRUD (backend-only — no UI yet) |
| `projection.ts` | Cash flow projection | Read-only calculation (also injects mortgage + budget transfers) |
| `scenario.ts` | "What If?" projection | Read-only, ephemeral — never persisted |
| `admin.ts` | Users & app settings | User CRUD, settings (admin only) |
| `maintenance.ts` | Data maintenance | History compaction preview/run (prune snapshots/sessions) |
| `auth.ts` | Authentication | Sign-up, signup-enabled check |
| `user-preferences.ts` | User preferences | Read/update preferences |
| `app-info.ts` | App metadata | Version info |

## Cache Tags

After mutations, invalidate the appropriate cache tag:

```
user:{userId}:accounts
user:{userId}:recurring-items:{accountId}
user:{userId}:planned-items:{accountId}
user:{userId}:salary-configs:{accountId}
user:{userId}:investments
user:{userId}:debts
user:{userId}:receivables
user:{userId}:taxed-income:{accountId}
user:{userId}:reconciliation
user:{userId}:budgets
user:{userId}:goals
user:{userId}:mortgages        (a member's mortgage membership list)
mortgage:{mortgageId}          (member-agnostic; one updateTag reaches every member)
users                          (admin operations)
app-settings                   (admin operations)
all-data                       (admin cache clear)
```

> Scenarios (`scenario.ts`) and projections (`projection.ts`) are read-only and use **no** tags of their own.

## Adding a New Server Action

1. Create file in this directory with `'use server'` at top
2. Define Zod schema for input validation
3. Follow the authenticate → validate → execute → invalidate → return pattern
4. Add cached query wrapper in `src/lib/db/cached.ts` if data is read frequently
5. Use descriptive cache tags following the `user:{userId}:entity-type` pattern
