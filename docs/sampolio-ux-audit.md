# Sampolio Visual UX Audit Report

**Auditor:** Claude (AI-assisted UX review)
**Date:** March 15, 2026
**Target user:** The developer's wife — a sociology PhD researcher, non-finance person, tight monthly budget, frequent travel reimbursements, Finnish student debt, needs motivation over complexity.

---

## Part 1: Screen-by-Screen Findings

### 1. Login Page

**Current state:** Centered card on a dark background. Money bag emoji as logo, "Sign in to Sampolio" heading, email/password fields, a prominent lilac/pink "Sign In" button, and a "Sign up" link below.

**Strengths:** Clean and minimal. No clutter. The emoji logo is playful. The form is straightforward with just two fields.

**Problems for the target user:** The dark background with a small centered card feels slightly cold and generic — like a developer tool login rather than a personal finance app she'd want to return to. There's no warmth or personality beyond the emoji. No "forgot password" link is visible.

**Specific suggestions:**
- Add a brief tagline below the logo (e.g., "Your money, your plan") to set a warm, personal tone from the start.
- Add a "Forgot password?" link below the password field.
- Consider a subtle background pattern or gradient instead of flat dark grey to make it feel less like a server admin panel.
- The money bag emoji works but a custom logomark would elevate perceived quality.

---

### 2. Overview / Main Dashboard

**Current state:** After login, the user lands on "Overview" — a dashboard showing 6 summary cards across the top (Net Worth, Liquid Assets, Cash, Investments, Receivables, Debts), a large Net Worth Projection stacked bar chart (with 6M/1Y/3Y/5Y toggles), a "This Month Impact" sidebar card, and at the bottom a "Projected Net Worth" number with quick-action buttons (Add Income, Add Expense, Add Receivable, Add Debt).

**Strengths:**
- The 6 summary cards at the top give a rapid snapshot of financial position.
- The Net Worth Projection chart is well-implemented with time range toggles.
- "This Month Impact" card showing the Finland balance with a green positive delta is a good glanceable summary.
- "View Month Details" link provides a clear call-to-action for deeper exploration.
- Quick-action buttons at the bottom are well-placed for adding new items.

**Problems for the target user:**
- **The first thing she sees is "Net Worth: -€79,720.65" in large text.** This is immediately anxiety-inducing. The negative number is driven primarily by the mortgage, but with no context it screams "you're in the red."
- **"Debts: -€127,723.65"** on the same row compounds the anxiety. There's no framing like "on track" or "68% paid off" to soften it.
- The dashboard answers "what are all my numbers?" but does NOT answer "am I okay this month?" — which is the #1 question for the target user.
- Too many financial concepts shown at once: Net Worth, Liquid Assets, Cash, Investments, Receivables, Debts. A non-finance person may not know the difference between Net Worth and Liquid Assets.
- The chart is dominated by the large red debt bars, which are visually overwhelming and create a sense of doom even though debt repayment is completely normal.
- No greeting, no personalization, no warmth. It's a wall of numbers.
- The "+€0,00 vs last month" badge on Net Worth feels broken or confusing.

**Specific suggestions:**
- **Replace the current top row with an "Am I okay?" hero card** showing: this month's projected end balance, whether it's up or down vs. last month, and a simple sentiment indicator (green checkmark / yellow caution / red warning). Push the detailed breakdown cards below or behind a "See details" toggle.
- **Reframe the Debts card** from "-€127,723.65" to a progress-oriented format: "Mortgage: 4.2% paid off" with a small progress bar, or simply hide it from the default view in Simple Mode.
- Add a personalized greeting: "Hi [Name], here's your March overview"
- Move the quick-action buttons from the bottom of the page (below the fold) to a more prominent position — or rely on the command palette / keyboard shortcuts which are already excellent.
- Consider making the net worth chart opt-in or showing a simpler "monthly balance trend" line chart by default.

---

### 3. Cashflow View

**Current state:** The main working screen. Top bar has a country selector ("Finland"), Add Income/Add Expense/Manage Items buttons. Below is a horizontal month scroller (Feb 2026 → Feb 2027), then a "Selected Month: March 2026" header showing Income/Expenses/Net totals. The main content area has a Sankey diagram ("Monthly Flow"), a "Month Details" sidebar listing income and expense items, a "Cashflow Projection" line+bar chart, an "Expenses Breakdown" treemap, and a "Projection Data" table at the bottom.

**Strengths:**
- The horizontal month scroller is intuitive and well-designed — green highlight on the current month.
- The Sankey diagram effectively shows money flowing from income through budget into expense categories. It's visually interesting and tells a story.
- Month Details sidebar is excellent — it lists every income and expense item with category badges and amounts, sorted by amount. Very scannable.
- The Expenses Breakdown treemap is colorful and immediately shows which expenses are the biggest.
- Income/Expenses/Net summary in the month header is a clean summary.
- Starting and Ending balance indicators on the Sankey chart (Start: €7,170.63, End: €9,018.26) are helpful.

**Problems for the target user:**
- **Information overload.** There are 4 distinct visualizations on one page (Sankey, line chart, treemap, data table) plus the month details sidebar. For someone who just wants to know "how am I doing this month?", this is overwhelming.
- The Sankey diagram, while powerful, requires financial literacy to read. Terms like "Budget" as a node in the flow may confuse — budget is an abstract concept being visualized as a concrete flow node.
- The treemap uses category-based colors (Investment = magenta, Utilities = yellow-green, etc.) but there's no legend and the color mapping is inconsistent with the Sankey.
- The "Projection Data" table at the bottom is a 12-column spreadsheet that will look intimidating to a non-spreadsheet person.
- The "country selector" dropdown labeled "Finland" is confusing — is this a country or a bank account? (It's actually a cash account name.)
- "Manage Items" button label doesn't clearly communicate what it does.
- Category badges (Housing, Shopping, Investment, Utilities) use different colors but there's no clear color system explained anywhere.

**Specific suggestions:**
- **Implement a Simple/Advanced toggle** that, in Simple mode, shows only: the month summary (Income/Expenses/Net), the Month Details list, and the treemap. Hide the Sankey, projection chart, and data table behind "Advanced" or "See more."
- Rename the account selector from "Finland" to show it's an account — e.g., add a bank icon or label "Account: Finland."
- Replace "Manage Items" with "View all items" or add icons to make the button's purpose clearer.
- In the Month Details sidebar, add a running subtotal or "remaining budget" indicator at the top so the user can see at a glance if they're within budget.
- Consider collapsing the Projection Data table by default and letting users expand it.

---

### 4. Charts and Visualizations

#### Sankey Diagram (Monthly Flow)
**Current state:** Shows income flowing through "Budget" into expense categories with named items.

**Strengths:** Visually compelling, shows the flow narrative.

**Problems:** Labels overlap when there are many small items (e.g., "Apple One + stor...", "Nordea fees", "Net Savings" all cramped at the bottom right). The "Budget" node in the middle is an abstraction that may confuse non-finance users.

**Suggestion:** In Simple mode, replace with a simple stacked bar showing income vs. categorized expenses side by side. Keep Sankey for Advanced mode.

#### Cashflow Projection (Line + Bar chart)
**Current state:** Bars for income (green) and expenses (red) per month, with a purple line showing balance trend over 12 months. A minimap/scrollbar at the bottom.

**Strengths:** Clear upward balance trend is encouraging. The minimap for zooming is a nice touch.

**Problems:** Income and expenses are nearly the same height each month, making them look scary (expenses almost equal income). The purple balance line is the most useful element but it's thin and easy to miss.

**Suggestion:** Make the balance line bolder. Consider showing only the balance line in Simple mode, with a green zone shading to indicate "healthy" range.

#### Expenses Breakdown (Treemap)
**Current state:** Colorful treemap with rectangles sized by expense amount. Mortgage (€663.31) and Credit card (€600.00) are the largest blocks.

**Strengths:** Immediately shows where the money goes. Intuitive proportional sizing. Colors are vivid and distinguishable.

**Problems:** Some labels are truncated ("Electr...", "Inte", "€5..."). The treemap doesn't distinguish between fixed costs you can't control (mortgage) and discretionary spending you can.

**Suggestion:** Add a filter or visual distinction between fixed/essential and discretionary expenses. Consider using consistent warm/cool color families for needs vs. wants.

#### Net Worth Projection (Overview page, stacked bar)
**Current state:** Stacked bars showing Cash Accounts, Investments, Receivables, and Debts over time. Debts are shown as large red bars below zero.

**Problems:** The massive red debt bars dominate the visual and create a sense of financial doom, even though the household is actually doing well month-to-month. For the target user who has debt anxiety, this chart is counterproductive.

**Suggestion:** Offer an alternative "Balance trend" view that shows only the cash + liquid assets line, hiding the debt visualization. Or show debt as a decreasing line (progress toward zero) rather than a looming red bar.

---

### 5. Add Income Form

**Current state:** A modal dialog with Type toggle (Income/Expense), Recurrence toggle (Recurring/One-Off/Salary), and fields for Name, Amount (EUR), Category dropdown, Frequency dropdown, Start Month, End Month (optional), and an Active toggle. Helper text below each field.

**Strengths:**
- Helper text under each field is excellent — explains what each field does in plain language.
- Good placeholder examples (e.g., "Freelance Work, Dividends").
- The Recurrence toggle is clear with a brief explanation below.
- Active toggle with explanation is smart for pausing items.

**Problems:**
- All fields are shown at once, which may feel like filling out a form at the bank.
- The Category dropdown defaults to "None" — it would be friendlier to suggest a category based on the name entered.
- "Frequency" dropdown with options like "Custom" may confuse — what does custom mean?
- Start Month uses a date picker format (2026-03) which is technical.

**Specific suggestions:**
- Consider a guided flow: Step 1 — "What's the name and amount?", Step 2 — "How often does it happen?", Step 3 — "Any other details?" (category, start/end). This would make it feel like a conversation rather than a form.
- Auto-suggest categories based on common names (e.g., typing "Netflix" suggests "Entertainment").
- Use a friendlier date picker — "Starting this month" / "Starting next month" / "Pick a month" instead of raw date input.

---

### 6. Add Expense Form

**Current state:** Nearly identical to Add Income but with "Expense" pre-selected and no "Salary" option in Recurrence.

**Strengths and problems:** Same as Add Income form above.

**Additional suggestion:** For the target user's travel reimbursement use case, add an "Expecting reimbursement?" toggle on expenses. When enabled, it could ask for expected reimbursement date and mark the expense differently in projections.

---

### 7. Salary Calculator

**Current state:** Accessible via the "Salary" recurrence type within Add Income. Shows Gross Salary (Monthly) field, Tax Rate (%), Contributions (%), Other Deductions (Fixed Amount), a Benefits section with "+ Add Benefit," a Calculated Net Salary display, an "Add as recurring income item" toggle, and Start/End Month.

**Strengths:**
- Very powerful tool for accurately modeling take-home pay.
- "Calculated Net Salary" updates dynamically — good feedback loop.
- Benefits section with taxable/non-taxable distinction is sophisticated.
- Helper text explains each field well.

**Problems:**
- This is an advanced feature buried inside the "Add Income" form behind a mode toggle. Someone who doesn't know tax rates off the top of their head will feel lost.
- Tax Rate and Contributions as percentages require the user to know these numbers, which many people don't.
- The label "Contributions (%)" is vague — contributions to what?

**Specific suggestions:**
- Add country-specific presets (e.g., "Finland defaults: Tax ~26%, Social contributions ~8.19%") that auto-fill — which actually seems to already exist in Settings but isn't connected to the form's UX in an obvious way.
- Add a tooltip or info icon explaining "Contributions" means pension/social security.
- Consider moving the salary calculator to its own dedicated section or page rather than hiding it inside the Add Income modal.

---

### 8. Investments Panel

**Current state:** A right-side slide-out panel accessed by clicking the "Investments" card on the Overview. Shows "Stock portfolio" with current value (€18,680.00) and growth rate (5% annual). Has edit, archive, and delete icons, plus a chevron to expand details. An "Archived" toggle and "+ Add" button at the top.

**Strengths:** Clean, minimal presentation. Archive feature is smart for keeping history.

**Problems:**
- Very sparse — just one line item with minimal information. No growth visualization or projection.
- The edit/archive/delete icons are small and unlabeled — just colored circles/icons without text.
- The panel feels like an afterthought compared to the rich Cashflow view.

**Specific suggestions:**
- Add a small sparkline or growth trend next to each investment.
- Show the projected value at the end of the selected time horizon.
- Label the action icons or use tooltips on hover.

---

### 9. Debts Panel

**Current state:** Similar slide-out panel showing "Home mortgage" (€122,723.65, amortized, variable) and "Soalr panels" (€5,000.00, fixed-installment, fixed). Same edit/archive/delete icons.

**Strengths:** Shows the debt type (amortized vs. fixed-installment) and rate type (variable vs. fixed).

**Problems:**
- **"Soalr panels" — there's a typo** in the data (should be "Solar panels").
- **Large raw debt numbers with no progress context.** The user sees "€122,723.65" with no indication of how much has been paid off or how far along they are in repayment.
- The terminology "amortized · variable" is jargon — a non-finance person won't know what this means.
- No visual indication of progress — no progress bars, no percentage paid, no payoff date.

**Specific suggestions:**
- **Fix the typo** "Soalr" → "Solar."
- **Add progress framing:** Show "68% paid off" or "Paid down €X so far" with a progress bar instead of (or alongside) the raw remaining balance.
- Replace jargon labels with plain language: "amortized · variable" → "Monthly payments · Variable rate" or simply hide these details behind an "info" icon.
- Show estimated payoff date prominently: "On track to pay off by March 2042."
- Consider color-coding: green progress bar rather than the current neutral presentation.

---

### 10. Receivables Panel

**Current state:** Slide-out panel showing "Marja debt" at €24,000.00 remaining. Same layout as Investments and Debts panels. Description: "Money owed to you — personal loans, deposits, or any amount you expect to receive back."

**Strengths:** The description text is clear and helpful.

**Problems:**
- "Marja debt" as a name is potentially confusing — is this money owed TO you or BY you? The panel header says "Receivables" but the item name says "debt."
- No expected repayment schedule or timeline shown.
- This section could be leveraged for travel reimbursement tracking but currently has no concept of "expected by" dates.

**Specific suggestions:**
- Add an "Expected by" date field for each receivable.
- This is where travel reimbursements could live — add a sub-type like "Work reimbursement" that integrates with the expense it offsets.
- Consider renaming items to avoid the word "debt" in a receivables context — suggest "Marja owes" or "Loan to Marja."

---

### 11. Reconciliation Flow

**Current state:** A 3-step wizard (Select Month → Enter Balances → Review & Confirm) accessible via the "Reconcile" button in the sidebar or the top-right of the Overview. Step 1 lets you pick year/month and shows entities to reconcile (1 Cash Account, 1 Investment, 1 Receivable, 2 Debts). Step 2 shows each entity with its expected value pre-filled and an editable actual value field.

**Strengths:**
- The wizard format is smart — it breaks a complex task into manageable steps.
- Pre-filled expected values reduce friction — you only update what changed.
- The stepper (1-2-3) at the top clearly shows progress.
- Grouping by category (Cash Accounts, Investments, Receivables, Debts) is logical.

**Problems:**
- The word "Reconciliation" is accountant jargon. The target user may not know what it means or why she should do it.
- No explanation of *why* to reconcile or *how often* — is this a monthly thing? Weekly?
- The debts section in Step 2 shows "Remaining Installments" and "Installment Amount" fields, which are quite technical.
- No visual feedback on the difference between expected and actual values until Step 3.

**Specific suggestions:**
- Rename "Reconcile" to something friendlier: "Check my balances" or "Monthly check-in."
- Add an intro sentence in Step 1: "Let's make sure your app matches reality. Open your bank app and enter your actual balance for each account."
- Show the difference (delta) inline in Step 2 as the user types — e.g., "Expected: €5,323 — You entered: €5,200 — Difference: -€123."
- Add a monthly reminder/notification prompt: "It's the start of March — time for your monthly check-in?"

---

### 12. Settings Page

**Current state:** Sections for Appearance (dark mode toggle), Keyboard Shortcuts reference, Data & Export (JSON export/import), Accounts management, Categories (chip-based list with add/remove), Tax & Contribution Defaults, and Admin Settings (self-signup toggle, user management).

**Strengths:**
- Categories as removable chips is intuitive and visual.
- Tax defaults that pre-fill salary forms is thoughtful.
- Keyboard shortcuts reference is helpful for power users.
- Export/import for backup is essential for a self-hosted app.

**Problems:**
- The Admin Settings section (self-signup, manage users) is shown to all users — this should be visible only to admins, or at least visually separated.
- No per-user settings for things like preferred start-of-month view, default time horizon, or currency display.
- No "Simple/Advanced mode" toggle yet (planned feature).
- The dark mode toggle didn't seem to respond during testing — possible bug.

**Specific suggestions:**
- Add a "Display preferences" section: default view (Overview vs. Cashflow), preferred time horizon (6M/1Y), number format preferences.
- Add the planned Simple/Advanced mode toggle here.
- Separate Admin settings into its own section/page or behind a disclosure.
- Add profile/avatar settings so each user feels they have their own space.

---

### 13. Command Palette

**Current state:** Opened via Cmd+K or the search icon. Shows a search input and list of actions: Start Reconciliation, Add Income, Add Expense, Go to Overview, Go to Cashflow. A helpful hint at the bottom: "Try: 'add 120 groceries feb' or 'go to cashflow'."

**Strengths:**
- The natural language hint is fantastic — it suggests you can type "add 120 groceries feb" which is a power-user shortcut.
- Clean, fast, keyboard-accessible.
- Icons for each action type.

**Problems:**
- Limited actions available — no way to navigate to Settings, edit an existing item, or search for a specific expense.
- The search icon in the sidebar and Cmd+K open the same thing — having two access points is good but they could be differentiated (search for items vs. command palette).

**Specific suggestions:**
- Add more commands: "Go to Settings," "Toggle dark mode," "Show this month's expenses."
- Add item search: typing an expense name like "mortgage" should find and let you edit it.
- Add fuzzy matching so partial words work.

---

### 14. Navigation Structure

**Current state:** Left sidebar with: Sampolio logo, Reconcile button + search icon, Overview link, Cashflow link, Settings link. User name at the bottom. A floating chevron "<" button on the left edge to collapse the sidebar.

**Strengths:**
- Three-item navigation is refreshingly simple.
- The active page is clearly highlighted with a background color.
- User name at the bottom provides identity context.

**Problems:**
- Only 3 pages in the nav (Overview, Cashflow, Settings) but Investments, Debts, and Receivables are hidden behind card clicks on the Overview — there's no obvious way to find them from the sidebar.
- The Reconcile button is oddly placed at the top of the sidebar above the navigation — it looks like a page but it's actually an action that opens a modal.
- The sidebar collapse button ("<") is floating mid-page and looks disconnected from the sidebar.
- No user avatar or logout option visible without scrolling.

**Specific suggestions:**
- Add "Investments," "Debts," and "Receivables" as sub-items under an "Assets & Debts" section in the sidebar — or at least make them easily discoverable.
- Move the Reconcile action into the command palette or as a page rather than a floating button.
- Add a user menu (click on name at bottom) with: Profile, Logout, Switch theme.

---

## Part 2: Cross-Cutting UX Themes

### Information Density
The app oscillates between sparse (Investments panel: one line item in a large panel) and overwhelming (Cashflow page: 4 charts + sidebar + table + month scroller all at once). There's no middle ground. The target user needs a "just right" density — enough to feel informed, not so much that she feels she needs to study it.

### Inconsistent Patterns
- Investments, Debts, and Receivables all use slide-out panels from the Overview, but Cashflow gets its own full page. This inconsistency means the user has to learn two different navigation patterns.
- The edit/archive/delete icons in the slide-out panels are unlabeled colored dots, but in the Cashflow Items table they're recognizable icons (checkmark, pencil, trash). The panel icons need labels or tooltips.
- Some forms are modals (Add Item), some are slide-out panels (Investments), and reconciliation is a wizard modal. Consistency would help.

### Missing Affordances
- The summary cards on the Overview page look like they should be clickable (and they are!) but have no hover state or visual cue indicating interactivity. Adding a subtle hover effect or "→" arrow would help.
- Category badges in Month Details look like they might be filterable but aren't.
- The "Projection Data" table rows aren't interactive — clicking a month could navigate to that month's detailed view.
- No tooltips anywhere on charts — hovering over a bar in the projection chart should show the exact value.

### Color and Typography
- The serif italic headings ("Overview," "Cashflow," "Settings") give a distinctive personality but feel slightly at odds with the data-dense UI. They work well for page titles but shouldn't be used for data labels.
- Green = income, Red = expenses is consistently applied and correct.
- Category colors (magenta for Investment, green for Housing, yellow for Utilities) seem arbitrary and don't map to any intuitive system.
- The lilac/pink accent color (buttons, toggles) is distinctive but feels disconnected from the finance domain.
- Text readability on the dark theme is generally good, with white text on dark cards. The gray helper text could be slightly brighter for better readability.

### Emotional Tone
The app currently feels like a **developer's power tool** — data-dense, chart-heavy, and terminology-rich. It's impressive technically but emotionally neutral-to-cold. For the target user, the emotional journey of opening this app is: see big negative numbers → feel anxious → close app. The app needs an emotional layer that says "you're doing fine" or "here's what you can control" before diving into the numbers.

---

## Part 3: Priority Improvements (Top 10)

### 1. "Am I Okay?" Dashboard (Large impact, Medium complexity)
Replace the current Overview top section with a simplified hero card showing: monthly surplus/deficit, balance trend (up/down arrow), and a simple sentiment indicator. This single change addresses the #1 need: "tell me I'm okay." The detailed cards (Net Worth, Liquid Assets, etc.) move below or behind a "See details" toggle.

### 2. Simple vs. Advanced Mode Toggle (Large impact, Medium complexity)
Per-user setting that controls information density across the entire app. Simple mode hides: Sankey diagram, projection table, technical debt terms (amortized/variable), net worth chart. Advanced mode shows everything. This is the architectural decision that makes all other improvements work — it lets the developer keep his power features while his wife gets a clean, calm experience.

### 3. Anxiety-Aware Debt Presentation (Large impact, Small complexity)
Reframe all debt displays from raw remaining balance to progress framing: "Solar panels: 78% paid off — €5,000 remaining of €22,500" with a green progress bar. Hide "amortized · variable" jargon behind info tooltips. Show estimated payoff dates. This is a relatively small change (presentation layer only) with enormous emotional impact.

### 4. Travel Reimbursement Tracking (Large impact, Medium complexity)
Add a "Pending reimbursement" toggle on expenses. When enabled, the expense appears in a special "Temporary" category in projections with a visual indicator (e.g., dashed border, different color). Once reimbursed, the user marks it as received. This directly addresses the wife's cash flow dips from work travel and prevents the false alarm of "oh no, I spent €800 I can't afford" when it's actually a temporary outlay.

### 5. Shared Expense Concept (Medium impact, Medium complexity)
Add a "Shared (50/50)" toggle on expenses. When enabled, the app shows the full amount but only counts half toward the user's projections. Optionally show "Your share: €331.66" next to "Full amount: €663.31." This could be a per-item or per-category setting, with a default split ratio configurable in Settings.

### 6. Guided Input Flows (Medium impact, Medium complexity)
Replace the current "all fields at once" Add Item form with a 2-3 step guided flow: "What is it?" → "How much and how often?" → "Any details?" Each step shows only 1-2 fields, with smart defaults and auto-suggestions. This makes adding items feel like answering questions rather than filling out a form.

### 7. Friendlier Reconciliation (Medium impact, Small complexity)
Rename "Reconcile" to "Monthly check-in." Add an intro explanation. Show expected-vs-actual deltas inline as users type. Add a monthly prompt/reminder. This is mostly copywriting and small UI tweaks but makes a confusing process approachable.

### 8. Goals Feature (Medium impact, Large complexity)
Let users set savings targets (e.g., "Save €5,000 by December for holiday") with progress bars on the dashboard. Show "on track" / "behind" / "ahead" indicators. This gives the target user motivation and a sense of purpose beyond just tracking numbers. Could be a new section in the sidebar.

### 9. "What If?" Playground (Medium impact, Large complexity)
A sandbox where users can try scenarios: "What if I increase my savings by €200/month?" "What if I get a raise?" Show the projected impact on balance and net worth without affecting real data. This is powerful for both users but especially for the wife who might want to explore "can I afford this trip?" scenarios.

### 10. Cashflow View Simplification (Medium impact, Small complexity)
In Simple mode, the Cashflow page shows only: month selector, Income/Expenses/Net summary, the Month Details list, and the treemap. The Sankey, projection chart, and data table are hidden behind an "Advanced" or "Show more charts" toggle. The full view remains for Advanced mode.

---

## Part 4: Visual Design Notes

### Overall Feel
The app currently feels like a **fintech dashboard** or **developer tool** — technically impressive, information-dense, and dark. It's the kind of UI a developer would be proud to build but that a non-technical user might find intimidating. The dark theme reinforces a "serious business" tone.

### Color Palette
- **Dark theme base:** Very dark greys (#1a1a2e range) with slightly lighter card backgrounds. This is well-executed technically but feels heavy.
- **Accent color (lilac/pink):** Used for primary buttons and toggles. It's distinctive and gender-neutral, which is good. However, it doesn't reinforce any financial meaning.
- **Green/Red for income/expenses:** Correctly applied and consistent. Good.
- **Category colors:** Seem randomly assigned. A more intentional palette (e.g., warm tones for discretionary spending, cool tones for fixed costs) would add information through color.
- **The purple/blue gradient** at the top of the Cashflow page is a nice touch — it adds visual interest and breaks up the monotony.

### Typography
- **Serif italic for page titles** (e.g., *"Overview"*, *"Cashflow"*) is a bold choice that gives the app personality. It works and sets Sampolio apart from generic dashboards.
- **Body text** is clean and readable in the sans-serif font.
- **Number formatting** uses European conventions (€1 847,63) which is correct for Finland.
- **Helper text** below form fields is slightly too dim on the dark background — consider bumping the opacity up.

### Spacing and Breathing Room
- The Overview page summary cards have good spacing between them.
- The Cashflow page is too dense — the Sankey diagram, Month Details, projection chart, and treemap are all crammed with minimal vertical breathing room.
- The slide-out panels (Investments, Debts, Receivables) have too much empty space — the opposite problem.
- Form modals are well-spaced internally.

### Icons and Visual Cues
- The emoji-based icons on the summary cards (💰 📊 👥 📃) are charming but inconsistent in style — some are emoji, some appear to be custom.
- The edit/archive/delete icons in slide-out panels are ambiguous — three small circles/icons with no labels and no tooltips.
- The sidebar navigation icons (house, dollar sign, gear) are clear and appropriate.
- No loading states, empty states, or success/error animations were observed — adding these would make the app feel more polished and responsive.

### Suggestions for Warmth
- Consider a warm neutral palette option alongside the current dark theme — something with soft whites, warm greys, and muted natural tones rather than the current cool dark theme.
- Add micro-interactions: subtle animations when adding items, progress bar fills on debts, confetti when a goal is reached.
- Use encouraging copy throughout: "Nice — you saved €200 more this month!" instead of just showing the number.
- Add seasonal or contextual touches: "Winter heating costs may increase — here's how your budget looks" in January.
- The app name "Sampolio" is good — lean into it as a character/personality rather than just a title. Could it have a mascot or distinct visual identity beyond the money bag emoji?

---

## Summary

Sampolio is an impressively feature-complete personal finance tool that clearly works well for its developer. The core functionality — cashflow tracking, projections, salary calculator, reconciliation — is solid and well-built. The technical foundation (Next.js, PrimeReact, charts) supports everything needed.

The gap between "great for the developer" and "great for his wife" is primarily about **emotional framing, information density, and progressive disclosure.** The data is all there; it just needs to be presented differently depending on who's looking. The Simple/Advanced mode toggle is the single most important architectural change, because it enables every other improvement without removing anything the developer loves.

The three quickest wins that would make the biggest difference right now are: (1) an "Am I okay?" hero card replacing the anxiety-inducing number wall, (2) progress-based debt display, and (3) renaming "Reconcile" to "Monthly check-in" with better explanatory copy. These are all achievable without major refactoring.
