# Wealth Page (`/wealth`)

Balance sheet view showing comprehensive asset and liability management across all entity types.

## Key File

`page.tsx` — Displays net worth composition with charts and tables.

## Features

### Summary Cards
Four cards at the top:
- **Current Net Worth**: Aggregate of all assets minus liabilities
- **Projected Net Worth**: Net worth at end of planning horizon with change percentage
- **Total Assets**: Cash + investments + receivables
- **Total Liabilities**: Outstanding debts

### Asset Breakdown Cards
Cards for each entity type showing count and total value:
- Cash Accounts
- Investments
- Receivables
- Debts

### Tabbed Views

**Net Worth Chart** (Tab 1):
- Line chart showing net worth trend over time
- Uses ECharts via `src/components/charts/net-worth-chart.tsx`

**Wealth Breakdown** (Tab 2):
- Stacked area chart showing composition: cash, investments, receivables, debts
- Shows how each component contributes to total net worth

**Monthly Table** (Tab 3):
- Detailed data table with monthly breakdown
- Columns: Month, Cash, Investments, Receivables, Debts, Net Worth
- Scrollable with fixed header

## Data Source

Uses `src/lib/wealth-projection.ts` which aggregates:
- Cash account projections (from `src/lib/projection.ts`)
- Investment growth (compound monthly growth + contributions)
- Receivable balances (principal - repayments + interest)
- Debt amortization (interest payments, principal reduction)
