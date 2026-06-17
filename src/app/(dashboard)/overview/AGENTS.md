# Overview Page (`/`)

The root page redirects to this overview, which serves as the **wealth dashboard** — the main landing page of the application.

## Key File

`page.tsx` — Server component that fetches all data, then renders client components.

## Features

### KPI Cards (Top Row)
Six summary cards showing current financial position:
- **Net Worth**: Sum of all assets minus liabilities
- **Liquid Assets**: Cash + investments
- **Cash**: Total across all cash accounts
- **Investments**: Total investment valuations
- **Receivables**: Money owed to the user
- **Debts**: Outstanding liabilities (shown as negative)

Clicking a KPI card opens the **EntityListDrawer** (`src/components/ui/entity-list-drawer.tsx`) showing all entities of that type with create/edit/archive actions.

### Net Worth Projection Chart
ECharts line/area chart (`src/components/charts/net-worth-chart.tsx`) showing projected net worth over time:
- Toggle between "Net Worth Only" and "Breakdown" (cash, investments, debts, receivables)
- Time horizon selector: 6M, 1Y, 3Y, 5Y
- Displays projected net worth at horizon end with absolute and percentage change

### This Month Impact Panel
Shows top income and expense items affecting the current month, with amounts and categories.

### Quick Action Buttons
Floating action buttons for common operations:
- Add Income, Add Expense — opens `CashflowItemModal`
- Add Receivable — opens receivable form in drawer
- Add Debt — opens debt form in drawer

### Last Reconciled Date
Shows when data was last reconciled. Clicking opens the reconciliation wizard.

### Shared Mortgage Summary & Euribor Reminder
If the user is a member of a shared mortgage, the page computes their current-month equity/liability/stake (via the mortgage engine) and folds equity into net worth. It also surfaces a **reminder banner** when a mortgage's yearly Euribor rate is due for an update (`isEuriborUpdateDue` from `src/lib/mortgage-utils.ts`).

## Data Flow

1. Server component fetches: accounts, investments, debts, receivables, budgets, shared mortgage(s), wealth projection
2. Data passed to client components for rendering
3. User interactions (create/edit) happen via modals/drawers that call server actions
4. After mutations, `refreshData()` from AppContext triggers re-fetch

## Dependencies

- `src/lib/actions/investments.ts` — Investment data
- `src/lib/actions/debts.ts` — Debt data
- `src/lib/actions/receivables.ts` — Receivable data
- `src/lib/actions/accounts.ts` — Cash account data
- `src/lib/actions/shared-mortgages.ts` — Shared mortgage data + projection inputs
- `src/lib/wealth-projection.ts` — Wealth projection calculation (folds in mortgage equity)
- `src/lib/mortgage-projection.ts` / `src/lib/mortgage-utils.ts` — Mortgage engine + Euribor-due check
- `src/components/charts/net-worth-chart.tsx` — Main chart
- `src/components/ui/entity-list-drawer.tsx` — Entity list panel
