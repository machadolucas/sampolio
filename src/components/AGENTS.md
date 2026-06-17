# Components (`src/components/`)

React component library for the application.

## UI Framework

**PrimeReact** is the component library (not shadcn/ui or Material-UI). Import components from `primereact/*`:
- `primereact/button` — Button
- `primereact/inputtext` — InputText
- `primereact/inputnumber` — InputNumber
- `primereact/dropdown` — Dropdown
- `primereact/dialog` — Dialog
- `primereact/datatable` — DataTable
- `primereact/tabview` — TabView
- `primereact/steps` — Steps (wizard)
- `primereact/tag` — Tag
- `primereact/inputswitch` — InputSwitch
- `primereact/selectbutton` — SelectButton
- `primereact/message` — Message
- `primereact/tooltip` — Tooltip
- `primereact/progressspinner` — ProgressSpinner

**Icons**: `react-icons` (Material Design `Md*`, Font Awesome `Fa*`), `primeicons`, `lucide-react`.

## Directory Structure

### `charts/`
Data visualization components:
- `net-worth-chart.tsx` — ECharts line/area chart for net worth over time
- `wealth-chart.tsx` — ECharts stacked chart of wealth composition (cash, investments, receivables, liabilities) over time
- `monthly-flow-chart.tsx` — ECharts Sankey diagram for income → expenses flow
- `cashflow-waterfall-chart.tsx` — ECharts waterfall chart for balance progression
- `expense-treemap-chart.tsx` — ECharts treemap for expense proportions

All charts use ECharts via `echarts-for-react` wrapper. Chart.js is also available but ECharts is preferred. Feature-specific charts live with their feature: see `mortgage/mortgage-charts.tsx` + `mortgage/mortgage-sankey.tsx` and `budgets/budget-month-chart.tsx`.

### `layout/`
- `app-layout.tsx` — Main layout wrapper with AppContext provider. Manages drawer state, selected account, refresh callbacks, sidebar state. This is the central state hub.
- `sidebar-nav.tsx` — Left navigation sidebar with six routes (Overview, Cashflow, Mortgage, Budgets, "What If?", Settings), a monthly check-in / search action, user menu, theme toggle, collapse button.

### `modals/`
Entity create/edit forms:
- `cashflow-item-modal.tsx` — Unified modal for income/expense items. Handles recurring, one-off, salary, and taxed income types. Largest and most complex modal.
- `occurrence-override-dialog.tsx` — Edit/skip a single occurrence of a recurring item.
- `users-modal.tsx` — Admin user management
- `index.ts` — Barrel exports for all modals

Investment / debt / receivable create-edit forms are no longer standalone modal files — they are rendered from `ui/entity-list-drawer.tsx` (routed via `ui/entity-modal-router.tsx`).

### `mortgage/`
Shared-mortgage UI: `mortgage-setup-wizard.tsx`, `mortgage-ledger-table.tsx`, `mortgage-charts.tsx`, `mortgage-sankey.tsx`, `mortgage-history-strips.tsx`, `mortgage-panels.tsx`, `mortgage-dialogs.tsx`, `mortgage-reconcile-dialog.tsx`, `mortgage-import-dialog.tsx`.

### `budgets/`
Trip/project budget UI: `budget-setup-wizard.tsx`, `budget-card.tsx`, `budget-verdict-card.tsx`, `budget-coverage-bars.tsx`, `budget-vs-actual-bars.tsx`, `budget-expense-log.tsx`, `budget-month-chart.tsx`, `budget-panels.tsx`, `budget-dialogs.tsx`, `budget-confirm-dialog.tsx`, `budget-export-dialog.tsx`, `budget-templates.ts`.

### `onboarding/`
- `onboarding-wizard.tsx` — 5-step guided setup: Welcome → Cash Account → Income → Expenses → Done. Shown to new users who haven't completed onboarding.

### `providers/`
Context providers wrapped around the app:
- `theme-provider.tsx` — Dark/light mode management
- `prime-provider.tsx` — PrimeReact configuration

### `reconcile/`
- `reconcile-wizard.tsx` — 3-step reconciliation process: Select month → Enter actual balances for all entities → Review variances and confirm. Special handling for debt installments.

### `ui/`
Shared UI components:
- `command-palette.tsx` — Cmd+K command palette with search, navigation, and action commands
- `entity-list-drawer.tsx` — Slide-in drawer showing lists of entities by type (cash, investments, receivables, debts) with inline create/edit/archive forms
- `entity-modal-router.tsx` — Routes entity types to the correct create/edit form
- `debt-progress-card.tsx` — Compact debt payoff progress card (uses `getDebtPayoffInfo` from `lib/debt-utils.ts`)
- `status-hero-card.tsx` — Headline status/summary card
- `form-primitives.tsx` — Shared form field building blocks
- `index.ts` — Barrel exports

The occurrence-override dialog lives in `modals/occurrence-override-dialog.tsx`.

## Patterns

### Modal/Drawer Flow
1. User clicks action button → AppContext's `openDrawer()` sets drawer state
2. `EntityModalRouter` reads drawer state and renders the appropriate modal
3. Modal calls server action on save → cache invalidated → `refreshData()` called
4. Parent component re-fetches data

### Form Pattern
All forms use React Hook Form with Zod validation:
```tsx
const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
  resolver: zodResolver(formSchema),
  defaultValues: { ... }
});
```
