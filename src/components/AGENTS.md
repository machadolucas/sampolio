# Components (`src/components/`)

React component library for the application.

## UI Framework

App-owned shadcn/ui components use **Base UI** behavior primitives and Tailwind v4 styles. Import individual modules from `@/components/ui/*`; `components.json` records the Base UI registry configuration. The UI foundation and source provenance are documented in `docs/architecture.md`. Do not introduce a component barrel that eagerly loads chart dependencies.

- `button`, `input`, `input-number`, `select`, `date-picker`, `controls` — accessible form controls; compatibility import modules (`input-text`, `dropdown`, `calendar`, etc.) re-export these app-owned contracts.
- `dialog` / `sheet` — Base UI modal focus management, optional maximize, caller-controlled dismissal; narrow dialogs become safe-area-aware bottom sheets. Dialogs do not support free dragging/resizing.
- `confirmation` — one queued Base UI AlertDialog host; details below.
- `data-table` — TanStack Table sorting, pagination (first/previous/direct-page/next/last), expansion and pinned columns; declarative `Column` children describe columns. Use `scrollRef` for the real `[data-slot="table-scroll"]` viewport. The rounded opaque `table-surface` clips the shared controls and table together; keep scrolling on the inner viewport.
- `chart` — `react-chartjs-2` wrapper registering the used Chart.js families; `chart-theme` applies theme-aware neutral chrome per instance without changing datasets, callbacks or chart identity. ECharts remains separate and lazy-loaded.
- `page-header` — `PageHeader` supplies a nonsticky glass title/action rail; `MaterialToolbar` adds a bounded control rail with optional sticky placement; `ControlGroup` is a solid inset group inside cards or glass. Never nest blur planes. `TabView` and `Steps` already own their inset rail: do not wrap them in another group. Shared layer/offset contracts live in `docs/architecture.md` §17.
- `tooltip` — explicit trigger/content composition; never target a global CSS selector.

**Material and accessibility**: system font, green semantic tokens, opaque data cards/forms, strongly filled overlays and glass chrome (`src/app/globals.css`); reserve glass for bounded navigation/control surfaces. Switch tracks stay 48×30px without flex shrink, with a 44px hit area. Use at least 44px targets, native labels, full-contrast helper/error text, explicit disabled states, and the shared reduced-motion/transparency preferences. Icons use `lucide-react` or existing `react-icons` families. Use semantic card/muted/border tokens for neutral surfaces; preserve financial/category colors. Overlay headers own their blur, with opaque content/footer and no filtered parent. Money-bearing route boundaries must subscribe to AppContext to update immediately on Demo toggles without remounting drafts (see `docs/features.md` §10).

## Directory Structure

### `charts/`
Data visualization components:
- `net-worth-chart.tsx` — Chart.js (`ui/chart.tsx`) line/area chart for net worth over time; a Total assets/Liquid scope toggle and net-worth-only/breakdown toggle; reuses `src/lib/wealth-chart-style.ts`'s `WEALTH_COLORS`/`wealthCategoriesForScope()`/`computeScopedNetWorth()` so its tooltip enumerates every in-scope non-zero category.
- `wealth-chart.tsx` — Chart.js stacked-band chart of wealth composition, scoped `total` (Cash, Investments, Receivables, Home value / Debts, Credit cards, Mortgage) or `liquid` (Cash, Investments, Debts, Credit cards), plus a Net worth line overlay; all-zero series omitted. Shares the pure `src/lib/wealth-chart-style.ts` color/scope helpers with `net-worth-chart.tsx`. Its Chart.js legend is the only legend (no separate HTML legend).
- `monthly-flow-chart.tsx` — ECharts Sankey diagram for income → expenses flow (gross salary **and** gross taxed income split into deduction outflows via `isGrossSource`)
- `cashflow-waterfall-chart.tsx` — ECharts waterfall chart for balance progression
- `expense-treemap-chart.tsx` — ECharts treemap for expense proportions
- `scenario-comparison-chart.tsx` — lazy ECharts "Balance over time" line chart for the Playground (dashed Current plan vs solid With changes, zero markLine, red overlay tracing below-zero stretches)
- `split-spend-chart.tsx` — lazy ECharts stacked bars for the /split Insights section (spend By member (default) / By category / By group toggle; group/member series use the stable hash palette, category mode buckets via `bucketSpendByCategory` top-8 + 'Other' and colors via `getCategoryColor`)
- `split-net-chart.tsx` — lazy ECharts running-net line for the /split Insights section (viewer net over time, zero markLine) over green/orange monthly-change bars; first bar measured against `viewerNetBaseline`, and when the standing balance dwarfs the deltas the bars use a hidden zero-aligned second y-axis so they stay readable

Charts mix ECharts (`echarts-for-react`, preferred for Sankey/waterfall/treemap) and Chart.js (`ui/chart.tsx`, also used by budget and mortgage views). Feature-specific charts live with their feature: see `mortgage/mortgage-charts.tsx` + `mortgage/mortgage-sankey.tsx` and `budgets/budget-month-chart.tsx`.

- **No barrel**: there is no `charts/index.ts` — import each chart from its own module (a barrel would drag the ECharts charts' side effects into every importer and defeat `next/dynamic` code-splitting).
- **Escape tooltip HTML**: an ECharts `tooltip.formatter` string is assigned to `innerHTML`, so every user-controlled value in it (names, categories, labels, axis values) must go through `escapeHtml` (`src/lib/html-escape.ts`) — a co-member's name like `<img onerror=…>` would otherwise run as script. Canvas-rendered label/axis formatters do not need it. Every ECharts chart above plus `mortgage-sankey.tsx` does this.

### `layout/`
- `app-layout.tsx` — Main layout wrapper with AppContext provider. Manages drawer state, the shared account list (`accounts` + `accountsLoaded`, flipped in the same transition as the list — pages such as Cashflow read accounts from here instead of fetching their own), refresh callbacks, sidebar state. This is the central state hub. `ReconcileWizard` and `OnboardingWizard` are `next/dynamic` and mount only once first opened (`reconcileMounted`/`onboardingMounted`), then stay mounted. The lg+ Demo indicator pill is rendered here (fixed, z-45); below `lg` it lives inside `MobileTopBar`.
- `mobile-top-bar.tsx` — Mobile (< lg) floating top bar: hamburger, truncating brand, **Add shared expense**, search; while demo mode is on, a 44px "Demo" pill sits in the bar's own flow **before** Search (tap turns demo mode off), so toolbar actions never cover scrolling amounts. Desktop quick-add lives in the sidebar. Mobile toolbar glass is a clipped background sibling of the controls; `AppLayout` supplies a solid mobile status-bar safe-area cap (native iPhone verification remains required).
- `sidebar-nav.tsx` — Left navigation sidebar with the app routes (from the shared `nav-config.tsx` via `useVisibleNavItems()`, which filters to `simpleModeVisible` entries in Simple display mode), search and 44px **Add shared expense** quick actions above the independently scrolling route list (collapsed quick-add uses a centered Plus and tooltip; the monthly check-in lives on Overview + ⌘M/palette, not in the chrome), user menu (`useUserMenuItems` in `nav-config.tsx`: a name+email template inside the clickable Account menu item, full-contrast name + muted truncated email; theme/display-mode/sign-out items use an icon+label template with `flex items-center gap-2`), theme toggle, collapse button.
- `bottom-nav.tsx` — Mobile (< lg) floating capsule bottom bar: N+1 equal cells — the user's 1–4 chosen tabs (resolved by `resolveBottomNavIds` from `src/lib/bottom-nav-prefs.ts`, i.e. `UserPreferences.bottomNavIds` or the per-display-mode defaults) plus a fixed "More" cell that opens the drawer. Labels/icons come from `navItems`; the sliding active pill and cells share the same unpadded inner track, with `100 / cells` width; outer capsule padding must not enter their geometry.
- `brand-logo.tsx` — Inline-SVG brand mark (euro coin + rising chart, money-green) mirroring `public/icons/icon.svg`; gradient id scoped with `useId()` since the sidebar/top-bar/drawer are all mounted at once. Used as the logo in all nav surfaces and the auth pages (replaced the old 💰 emoji).

### `modals/`
Entity create/edit forms:
- `cashflow-item-modal.tsx` — Unified modal for income/expense items (RHF + `zodResolver(cashflowItemSchema)`, `src/lib/schemas/cashflow-item.schema.ts`). Handles recurring, one-off (incl. reimbursement tracking: expect-reimbursement checkbox + expected month + pending/received status on edit), salary, and Gross income (taxed income: salary-tax-settings toggle or custom rates, live net preview, skip-occurrence chips) types; its list view is two sections — Regular items (monthly-equivalent summary cards + "≈ / month" column) and One-time items (upcoming strip + month-sorted table). Largest and most complex modal.
- `occurrence-override-dialog.tsx` — Edit/skip a single occurrence of a recurring item.
- `users-modal.tsx` — Admin user management (incl. a Passkeys count column and a per-user **Remove passkeys** action in the edit dialog)
- `index.ts` — Barrel exports for all modals

Investment / debt / receivable create-edit forms are no longer standalone modal files — they are rendered from `ui/entity-list-drawer.tsx` (routed via `ui/entity-modal-router.tsx`).

### `mortgage/`
Shared-mortgage UI: `mortgage-setup-wizard.tsx`, `mortgage-ledger-table.tsx`, `mortgage-charts.tsx`, `mortgage-sankey.tsx`, `mortgage-history-strips.tsx`, `mortgage-panels.tsx`, `mortgage-dialogs.tsx`, `mortgage-reconcile-dialog.tsx`, `mortgage-import-dialog.tsx`.

### `budgets/`
Trip/project budget UI (`budget-card.tsx` is a `next/link` to `/budgets/{id}`; `budget-expense-log.tsx` renders a stacked `lg:hidden` list beside its desktop table): `budgets-section.tsx` (the Budgets half of the merged "Trips & Budgets" page at `/budgets`, `<section id="budgets">`), `budget-setup-wizard.tsx`, `budget-card.tsx`, `budget-verdict-card.tsx`, `budget-coverage-bars.tsx`, `budget-vs-actual-bars.tsx`, `budget-expense-log.tsx`, `budget-month-chart.tsx`, `budget-panels.tsx`, `budget-dialogs.tsx`, `budget-confirm-dialog.tsx`, `budget-export-dialog.tsx`, `budget-templates.ts`.

### `split/`
Split-group UI (Splitwise replacement): quick-add sheet (amount field first + autofocused), expense/settle/recurrence/import dialogs, activity feed, category icons, `group-period-card.tsx` — the detail page's "Last 30 days" insights card (default-open `.collapse-grid` details with two CSS mini-treemaps — "By category" on `getCategoryColor`, "Who paid" on `getAvatarColor`, rects from the pure `computeTreemapLayout` in `src/lib/treemap-layout.ts`; each is `role="img"` labelled with names+percentages, money in legends/tooltips only — plus top expenses / `describeGroupPeriod` sentences; pure math in `computeGroupPeriodInsights`, deliberately no ECharts import) — and `bank-link-details-dialog.tsx` — display-only dialog showing another member's linked bank transaction (member, bank, date, amount, counterparty; never an IBAN). Member displays (balance banner, settle-up dropdowns, activity actors, detail rows) show `<UserAvatar>`s; detail/activity rows are whole-row clickable (expense → edit dialog, payment → row menu).

### `goals/`
Financial goal UI (rendered by `/goals`):
- `goal-card.tsx` — Progress bar, on-track/behind/achieved tag, projected reach date, edit/archive/delete actions.
- `goal-dialog.tsx` — Create/edit dialog (RHF + `zodResolver(goalSchema)`); conditional fields per tracking method (account dropdown / manual amount).

### `trips/`
Trip per-diem UI (rendered as the Trips section of the merged `/budgets` page; `/trips` redirects there):
- `trips-section.tsx` — The Trips half of the merged "Trips & Budgets" page (`<section id="trips">`, rendered first).
- `trip-card.tsx` — Summary card for a trip (status, total per diem, reimbursement month).
- `trip-dialog.tsx` — Create/edit dialog (day list, per-country segments, free-meal counts, rate snapshot).
- `per-diem-breakdown.tsx` — Day-by-day per-diem calculation breakdown.

### `bank/`
Enable Banking (PSD2 AIS, **read-only** sync) UI:
- `bank-connections-panel.tsx` — Connect/reconnect/disconnect banks; per-linked-account config (role cash/credit-card, anchor account, exclude, card statement/due day, manual credit limit, expected monthly spend, custom name) with autosave + field tooltips; the card summary line renders `effectiveCardNumbers` (owed/available/limit, each independent). Rendered in **Settings → Accounts & Banking**.
- `account-picker.tsx` — Sticky bank-tab row (connection/consent status dots, hidden for a single connection) + account-chip row (name + balance/owed); drives the `/bank` page's selected account.
- `bank-ledger-table.tsx` — Imported transaction ledger for one linked account: search box, infinite-scroll desktop DataTable (rows revealed as the inner scroll area nears its end) with a "Split" flag-pill column, and compact month-grouped mobile rows — each row has a named native details button and a pointer-row shortcut that toggle expansion; the "already split" pill and Split-this button sit between the title and the amount (inner buttons `stopPropagation`), so the amount + chevron form a constant-width right rail and amounts right-align across rows. Exact links, recovered pending→booked suggestions, and heuristic matches carry existing split details for duplicate warnings; the split flow can confirm a suggestion or explicitly acknowledge listed expense ids before creating another row. Rendered on the `/bank` page.
- `account-picker.tsx` — sticky bank/account chip switcher with **jiggle-mode reorder** (`docs/architecture.md` §17 Motion guidance): a long-press enters the mode, and **one shared jiggle state drives two `useJiggleReorder` instances** — the bank-tabs row reorders connections, the account-chips row reorders accounts within the active connection. Every move persists the flat id order to `UserPreferences.bankAccountOrder` (`updateBankAccountOrder`) immediately, and the page applies it via the pure `sortConnectionsByAccountOrder` (`src/lib/bank-utils.ts`) to the picker, the link list, and the default selection. (The old ⇅-button + ◀/▶ nudge-arrow reorder was removed in favor of jiggle mode.)

### `onboarding/`
- `onboarding-wizard.tsx` — 5-step guided setup: Welcome → Cash Account → Income (salary rates prefill from the user's `taxDefaults`) → Expenses → Done (asks the detail level and persists it as the display mode; lands on Home). Shown to new users who haven't completed onboarding.

### `providers/`
Context providers wrapped around the app:
- `theme-provider.tsx` — SSR-safe dark/light mode and device-local reduced-transparency stores; root prepaint resolves saved theme/OS preference before hydration, with memory fallback if storage is denied.
- `toast-provider.tsx` — app-wide toast surface. Mounts one Base UI Toast provider and viewport (bottom-center) in `AppLayout`; use `useToast()` (`success`/`error`/`info`/`show`) instead of per-component `<Toast>` refs. Fire it after every mutation.
- `celebration-provider.tsx` — `useCelebration().celebrate('checkmark' | 'confetti')`: the celebration overlays (split-expense create / settle-up; see `docs/architecture.md` §17 Motion guidance). The checkmark is a ~900ms badge-pop with an expanding ring + 6-dot burst + check draw (every keyframe uses `forwards` since the overlay unmounts). Mounted inside `ToastProvider` in `AppLayout`; returns `false` under reduced motion so callers fall back to flash-highlight + toast.

### `settings/`
- `account-panel.tsx` — Settings → Account: profile picture, change-password form, `PasskeysPanel`, danger zone (start fresh / delete account); dynamic-imported by the settings page.
- `passkeys-panel.tsx` — add/rename/delete passkeys (Better Auth passkey client) + the `PASSKEY_REAUTH_REQUIRED` "sign in again" prompt.
- `mobile-nav-card.tsx` — Settings → General "Mobile navigation" card: pick 1–4 bottom-nav tabs (chip grid over all `navItems`) and drag-reorder them in a preview row driven by `useJiggleReorder`; the greyed trailing "More" cell is never registered with the hook. Persists via `updateBottomNavIds` with optimistic `AppContext.setBottomNavIds` + rollback/toast; "Reset to default" sends `null`.

### `overview/`
Pieces of the `/overview` wealth dashboard:
- `banner-stack.tsx` — the page's reminder banners (check-in, Euribor, bank consent, budget) on the shared `AlertBanner`, plus `isCheckInBannerVisible`
- `kpi-group.tsx` — titled grid section wrapping the `KpiTile`s (Net / Assets / Debts & liabilities)
- `net-worth-explain-dialog.tsx` — plain-words, row-by-row breakdown of the net-worth sum (opened from the Net Worth tile)
- `wealth-distribution.tsx` — `WealthDistribution`: "Where your wealth sits", a slim CSS segmented bar + legend of the current asset split (Cash / Investments / Receivables / Home equity / positive Split balance), colored from the pure `src/lib/wealth-chart-style.ts` shared `WEALTH_COLORS`. Not a canvas chart, so no `ChartExplain`: the bar is `role="img"` with a generated `aria-label` and the legend/footer repeat it as text. Renders in both display modes.
- `forecast-vs-actual-card.tsx` — `PlanCheckCard`: "Plan vs reality" (pure engine in `src/lib/forecast-vs-actual.ts`)

### `reconcile/`
- `reconcile-wizard.tsx` — Monthly check-in. Advanced mode: 3 steps (Select month → Enter actual balances for all entities → Review variances and confirm), with special handling for debt installments. **Simple mode**: one screen — auto-starts a session on the current month, shows the pre-filled balances list with reassurance copy, and a single "Save check-in" button. Expected/actual values prefill from the engines' start-of-month values (`src/lib/reconcile-prefill.ts`; `docs/projections-and-reconciliation.md` §9). The dialog has no `dismissableMask` (a stray outside click must not discard entered balances). Snapshots are written sequentially; any failure stops before balances are applied, names the failed rows in an error + toast, and never shows "Check-in saved".

### `ui/`
Shared UI components:
- `command-palette.tsx` — Cmd+K command palette with search, navigation, and action commands (incl. `action-demo-mode` toggle)
- `jiggle-reorder.tsx` — shared iOS-style jiggle-mode reorder primitive (`useJiggleReorder` hook + `JiggleModeBar` pill); long-press → mode, drag/arrow-keys reorder; wobble on `[data-jiggle-inner]`, drag on `[data-jiggle-item]`; pure math in `src/lib/reorder-utils.ts`. Used by /split (group list), /bank (account-picker), and Settings → General (`settings/mobile-nav-card.tsx` bottom-nav tab preview). See `docs/architecture.md` §17 Motion guidance.
- `user-avatar.tsx` — `<UserAvatar>`: renders a user's avatar image (from `/api/avatars/[userId]`) or initials on a deterministic `getAvatarColor` hsl hash (`src/lib/avatar-utils.ts`), with `contrastTextColor` (`src/lib/color-contrast.ts`) selecting a readable foreground. Profiles resolved via the `useUserProfiles` hook (`src/lib/hooks/use-user-profiles.ts`, module cache + inflight dedup).
- `avatar-editor-dialog.tsx` — `AvatarEditorDialog`: drop/paste/browse → EXIF-normalized ≤2048px source → `react-easy-crop` round crop + zoom (lazy-loaded dependency) → 256×256 WebP q0.85 (JPEG fallback), saved via `updateMyAvatar` / admin `updateUser`.
- `entity-list-drawer.tsx` — Slide-in drawer showing lists of entities by type (cash, investments, receivables, debts) with inline create/edit/archive forms
- `entity-modal-router.tsx` — Routes entity types to the correct create/edit form
- `kpi-tile.tsx` — `KpiTile`: the shared KPI card (title/value/change badge/subline/progress bar); zero-delta changes render as muted "unchanged" text instead of a "+€0,00" badge; optional `help` prop renders a `HelpHint`
- `alert-banner.tsx` — `AlertBanner`: shared reminder/attention banner (check-in, Euribor, bank consent, budget warnings) with optional action button and dismiss
- `help-hint.tsx` — `HelpHint`: tap/hover "?" affordance showing plain-language help text (`src/lib/plain-language.ts`). A `::before` pseudo-element grows the hit area around the 16px glyph without changing layout — 44px on coarse pointers (`pointer-coarse:`), 24px for mouse so it never covers neighboring labels/inputs (tight callers add spacing on coarse pointers). The text is also rendered sr-only and linked via `aria-describedby`, because screen readers never announce the tooltip.
- `empty-state.tsx` — `EmptyState`: shared icon + title + body + action block for empty lists
- `debt-progress-card.tsx` — Compact debt payoff progress card (uses `getDebtPayoffInfo` from `lib/debt-utils.ts`). "% paid" is measured against `getDebtOriginalPrincipal` (the max of `initialPrincipal`, `Debt.originalPrincipal` — captured before the first check-in overwrites `initialPrincipal` — and the debt's snapshot balances), with "remaining" read at the current month (`currentMonth`), not the last amortization row.
- `status-hero-card.tsx` — `StatusHeroCard` props `{ userName, summary: HeroSummary | null, currency }`; `summary` comes from `deriveHeroSummary` (`src/lib/overview-hero.ts`); money strings are built at render time so demo masking applies (see the Overview `AGENTS.md`)
- `form-primitives.tsx` — Shared form field building blocks (`MonthPicker` takes an `inputId` so a `<label htmlFor>` can target it; `HelpTip`, `ItemCard`, `SubEntityList`)
- `delayed-loading.tsx` — `DelayedSpinner` / `DelayedSkeleton`: loading indicators that appear only after ~300ms (via `useDelayedFlag` in `lib/hooks/use-delayed-flag.ts`), so fast loads never flash a spinner
- `chart-explain.tsx` — the "Explain this chart" system: `ChartExplain` wrapper (button + inline `.collapse-grid` panel + sr-only description via `aria-describedby`), `ChartExplainButton`/`ChartExplainPanel` (canned `ReadCue[]` rows with `ChartCueSwatch` shapes + a generated "in plain words" list), `useChartExplain` (panel state; defaults open in Simple mode), and `useChartTour`/`ChartTourBar` (step tours with ECharts `dispatchAction` highlights — cashflow trio only). Descriptions come from the pure `src/lib/chart-descriptions.ts` (unit-tested); money formatting is demo-mask-aware (`demoMasked` in describe `useMemo` deps). Every canvas chart must integrate this — see `docs/architecture.md` §17 chart guidance.
- `skeletons.tsx` — content-shaped page skeletons (`KpiGridSkeleton`, `ChartsPageSkeleton`, `ListPageSkeleton`, `HomeSkeleton` (Home's glance/balances/activity region), `SplitDetailSkeleton`) used in place of full-page spinners on heavy pages (instant-shell pattern); size each block to the real content so the swap never shifts layout

Motion conventions (tokens, `animate-fade-in`/`rise-in`/`scale-in`, `.pressable`, `.collapse-grid`, the global reduced-motion kill-switch) live in `docs/architecture.md` §17 Motion guidance — clickable cards get `pressable` (which now includes a guarded hover shadow; extra `hover:shadow-md` is optional), tappable text rows get `transition-colors` + `active:bg-*`, and entrance classes go on once-mounted wrappers only.
- `index.ts` — Barrel exports

The occurrence-override dialog lives in `modals/occurrence-override-dialog.tsx`.

## Patterns

### Modal/Drawer Flow
1. User clicks action button → AppContext's `openDrawer()` sets drawer state
2. `EntityModalRouter` reads drawer state and renders the appropriate modal
3. Modal calls server action on save → cache invalidated → `notifyDataChanged()` (directly, or via `refreshData()` / `onDataChange`)
4. Every mounted view subscribed with `useDataRefresh(refetch)` re-fetches — in this tab and the user's other tabs (`src/lib/hooks/use-data-refresh.ts`, `docs/architecture.md` §13)
5. Submit buttons show `loading` while awaiting; on success the modal closes and a `useToast()` toast confirms; on hot paths the parent updates optimistically and reconciles via the background refetch (see root `AGENTS.md` → "Working rules")

Rule: a shared component that calls a mutating server action announces success itself with `notifyDataChanged()` (it may be mounted anywhere — the global quick-add, the bank ledger, a page), and any view that shows server data subscribes with `useDataRefresh`. A parent callback that only refreshes its own state is not enough.

### Form Pattern
All forms use React Hook Form with Zod validation:
```tsx
const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
  resolver: zodResolver(formSchema),
  defaultValues: { ... }
});
```

Dialog forms submit on Enter through `useFormSubmit` (`src/lib/hooks/use-form-submit.ts`):
```tsx
const onFormSubmit = useFormSubmit(save, { disabled: saving });
<form onSubmit={onFormSubmit} noValidate>
  …fields…
  <Button type="button" label="Cancel" onClick={onClose} />
  <Button type="submit" label="Save" loading={saving} />
</form>
```
Only the primary button is `type="submit"`; every other button inside the form is `type="button"`. The hook blurs only a focused `[data-commit-on-submit]` number field and runs the latest `save` on the next tick, after the locale-aware commit reaches React state. To clear an optional field, send `null` (an absent key keeps the stored value — see `src/lib/actions/AGENTS.md`). Stateful dialogs that stay mounted reset their fields on the closed→open transition during render (e.g. `mortgage-dialogs.tsx`).

- `InputNumber` wraps Base UI NumberField: controlled `number | null`, `fi-FI` parsing/formatting, raw intermediate text, bounds and precision; currency defaults to two decimals. `onValueChange` reports changes and `onValueCommitted` reports completed edits. Empty means `null`, never an option sentinel or `NaN`.
- `Calendar` uses `Date | null` at the UI boundary, typed Finnish day entry plus keyboard DayPicker, and local datetime input; `date-picker.tsx`'s `MonthPicker` uses `YYYY-MM | null`; the `form-primitives.tsx` adapter retains `string` with empty-string clearing for existing forms. Respect min/max and preserve local dates without UTC conversion. Merge DayPicker default `rdp-*` classes when styling; they define navigation geometry. Anchor the popup to the input wrapper, retain viewport collision handling and verify all date rows remain reachable near viewport edges.
- `Dropdown`/`MultiSelect` normalize scalar values (including zero/false), object options and groups; only `null` clears a single selection. `SelectButton` permits clearing by default; set `allowEmpty={false}` when the choice is required.
- RHF errors connect the actual control's `aria-invalid`/`aria-describedby` to a unique error id and announced message. Use `useId` prefixes for label/error ids because Next can retain inactive route instances. Password strength uses the shared policy, not length alone.

### Confirmations, dates
- The one `<ConfirmDialog />` in `AppLayout` serves queued requests. `confirmDialog({...})` preserves legacy **Yes / No**, accept focus; `requestConfirmation({...}): Promise<boolean>` defaults to **Confirm / Cancel**, reject focus. Explicit labels/focus override either API. Resolve/callbacks run after dismissal; the next request crosses a closed focus boundary, preventing double activation. Sign-out/unmount cancels pending requests. Never mount another receiver or call browser `confirm()` (`src/test/no-native-confirm.test.ts`).
- Display dates through the fi-FI helpers in `src/lib/constants.ts` — `formatDate`, `formatDateTime`, `formatDayMonth` (bare `YYYY-MM-DD` parsed as a local date) — and months through `formatYearMonth`, never ad-hoc `toLocaleDateString` calls.
