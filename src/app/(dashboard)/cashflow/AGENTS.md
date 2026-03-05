# Cashflow Page (`/cashflow`)

Monthly cash flow management page — the core feature for tracking income and expenses per cash account.

## Key File

`page.tsx` — Large client component (~600+ lines) managing all cashflow state and interactions.

## Features

### Account Selector
Dropdown in the page header to switch between cash accounts. Only shows active (non-archived) accounts. Selected account is stored in AppContext.

### Month Strip Navigation
Horizontal scrollable strip of months from the account's start date through its planning horizon. Clicking a month selects it and scrolls to show details. Current month is highlighted.

### Month Summary Banner
Shows for the selected month: total income, total expenses, and net change (income - expenses).

### Charts

**Monthly Flow Chart** (Sankey diagram):
- `src/components/charts/monthly-flow-chart.tsx`
- Visualizes income sources flowing through the budget to expense categories
- Clickable nodes — clicking an item opens its edit modal

**Cashflow Waterfall Chart**:
- `src/components/charts/cashflow-waterfall-chart.tsx`
- Shows balance progression month-by-month as a waterfall
- Each bar shows the net change, building on the previous month's ending balance

**Expense Treemap Chart**:
- `src/components/charts/expense-treemap-chart.tsx`
- Proportional visualization of expenses by category and individual items

### Month Details Panel
Breakdown of all income and expense items for the selected month:
- Sort by name or amount
- Click items to edit
- Tags for "edited" (overridden) items and categories
- Balance flow: Starting Balance → Net Change → Ending Balance

### Projection Data Table
Full monthly data table with columns: Month, Income, Expenses, Net Change, Balance.

### Edit Workflows

**Edit Choice Dialog**: When clicking a recurring item, asks whether to edit:
- "This occurrence only" — creates an occurrence override (PlannedItem with `isRecurringOverride: true`)
- "Entire series" — edits the RecurringItem itself

**Occurrence Override Dialog** (`src/components/ui/occurrence-override-dialog.tsx`):
- Allows changing the amount for a single month
- Option to skip the occurrence entirely (`skipOccurrence: true`)

**CashflowItemModal** (`src/components/modals/cashflow-item-modal.tsx`):
- Unified modal for creating/editing income and expenses
- Supports: Recurring, One-off, Salary, and Taxed Income item types
- For Salary: shows gross salary, benefits, tax rate, contributions, deductions with live net calculation

## Data Flow

1. Page fetches projection data via `getProjection(accountId)` server action
2. Projection engine (`src/lib/projection.ts`) calculates monthly balances
3. Results displayed as charts and tables
4. Edits go through server actions → file writes → cache invalidation → refresh

## Key Types

- `MonthlyProjection` — Monthly income/expense breakdown with balances
- `MonthFlowData` — Processed flow data for visualization
- `CashflowItem` — Individual income/expense item in a month
- `ProjectionLineItem` — Line item in a projection with source tracking

## Known Issues

_No known issues at this time._
