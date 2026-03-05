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
- `monthly-flow-chart.tsx` — ECharts Sankey diagram for income → expenses flow
- `cashflow-waterfall-chart.tsx` — ECharts waterfall chart for balance progression
- `expense-treemap-chart.tsx` — ECharts treemap for expense proportions

All charts use ECharts via `echarts-for-react` wrapper. Chart.js is also available but ECharts is preferred.

### `layout/`
- `app-layout.tsx` — Main layout wrapper with AppContext provider. Manages drawer state, selected account, refresh callbacks, sidebar state. This is the central state hub.
- `sidebar-nav.tsx` — Left navigation sidebar with three routes (Overview, Cashflow, Settings), user menu, theme toggle, collapse button.

### `modals/`
Entity create/edit forms:
- `cashflow-item-modal.tsx` — Unified modal for income/expense items. Handles recurring, one-off, salary, and taxed income types. Largest and most complex modal.
- `investment-modal.tsx` — Investment account create/edit
- `debt-modal.tsx` — Debt create/edit with amortized/fixed-installment types
- `receivable-modal.tsx` — Receivable create/edit
- `users-modal.tsx` — Admin user management
- `index.ts` — Barrel exports for all modals

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
- `entity-list-drawer.tsx` — Slide-in drawer showing lists of entities by type (cash, investments, receivables, debts) with create/edit/archive actions
- `entity-modal-router.tsx` — Routes entity types to the correct modal component
- `occurrence-override-dialog.tsx` — Dialog for editing a single occurrence of a recurring item (change amount or skip)

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
