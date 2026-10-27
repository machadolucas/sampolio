# Sampolio — UI/UX & Product Improvement Suggestions

Evidence-backed backlog of UI/UX, performance, and integration improvements.
**No suggestion removes functionality**; every interface must keep working well on
mobile (~375–390px) *and* desktop. Hard defects belong in
[`known-gaps.md`](known-gaps.md), not here.

The July 2026 audit backlog (cashflow header collapse, KPI grouping, mortgage
tabs, bank ledger pagination, playground stacking, category colors, the §11
integration features, and the rest) has been implemented in full — see the
retired-ideas note at the bottom. What remains:

## Open items

### 13.1 Broader UI test coverage
The synthetic Chromium suite covers every route and representative authentication,
form, table, import/export and reconciliation workflows at three widths. Extend
component coverage of remaining feature-specific state and action failures as those
areas change. Check real iPhone Safari/PWA keyboard, focus, safe areas and glass
compositing on another machine/device; Chromium emulation does not establish parity.
Coverage details and the isolated harness are in [architecture.md](architecture.md) §15.

### 13.2 Dependency compatibility bounds
- **TypeScript 7 / ESLint 10**: retain TypeScript 6 and ESLint 9 while the current
  TypeScript-ESLint and React/accessibility lint-plugin peer ranges exclude newer majors.
  Recheck the complete lint stack before adopting them.
- **Better Auth/passkey**: keep exactly paired versions; 1.7.12 is the installed
  stable pair permitted by the package manager's release-age policy. Never bypass that
  policy merely to match a planning target.

### 13.3 Form and mobile polish follow-ups
- **Enter-to-submit** (`useFormSubmit`, [architecture.md](architecture.md) §17 Forms) is
  not wired into `trip-dialog.tsx` or `settle-up-dialog.tsx`
  (no `<form>` there), so Enter does not save in those dialogs.
- **Admin users modal** (`src/components/modals/users-modal.tsx`) has no `lg:hidden`
  stacked list; its table is the only layout on a phone.
- **Budget setup wizard line rows** (`src/components/budgets/budget-setup-wizard.tsx`)
  label their inputs by placeholder only ("What is it?"), with no `<label>`/`aria-label`.

### Future ideas (unvetted)
- **Remote/push check-in notification**: the local opt-in notification only fires
  on app open; true scheduled delivery needs a push service — deliberately out of
  scope so far.
- **Manual card-payment fingerprint**: months older than a card's served history
  whose billing identity changed before that history begins can never
  auto-attribute; a "mark as card payment" affordance on a ledger row could teach
  the fingerprint manually and light up the backlog.
- **Cross-currency conversion** for aggregate displays (app-wide limitation, see
  AGENTS.md §Known Limitations).
- **Recurring-suggestion tuning**: the detector is conservative (3 consecutive
  months, one charge/month); quarterly/yearly pattern detection is unexplored.

---

*Retired ideas, for the record: the March 2026 audit items (the "Am I okay?" hero,
Simple/Advanced mode, monthly check-in rename, playground, goals backend, skeleton
loading states, progress-framed mortgage copy) and the entire July 2026 audit
backlog — collapsing cashflow header + single month-selection hook + gross-vs-net
caption + labeled mobile cards + account-selector affordance (§1), grouped KPI
tiles + zero-delta suppression + check-in de-duplication + shared
AlertBanner/KpiTile/EmptyState primitives (§2), tabbed mortgage layout +
consolidated Manage menu + payoff summary card (§3), stacked budget header +
per-month coverage strip (§4), split empty-state copy + per-group activity (§5),
bank ledger month grouping/search + card-row formatting (§6), lazy settings
tabs (§7), playground stacking/history/apply-to-plan (§8), Home glance tile +
quick-add copy (§9), lazy modal router + split item modal ("More options") +
category auto-suggest + CATEGORY_COLORS + labeled drawer actions + Simple-mode
phase 2 (§10), recurring-transaction detection, "Split this", plan-vs-reality,
Euribor prefill, local check-in notification, budget↔split link (§11), and the
§12 performance items — are all shipped. The shared-expense-ratio idea was
superseded by Split groups.*
