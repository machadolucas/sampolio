"use client";

import { MaterialToolbar } from '@/components/ui/page-header';

import { Search } from "lucide-react";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  DataTable,
  type DataTableExpandedRows,
} from "@/components/ui/datatable";
import { Column } from "@/components/ui/column";
import { Tag } from "@/components/ui/tag";
import { InputText } from "@/components/ui/input-text";
import { IconField } from "@/components/ui/icon-field";
import { InputIcon } from "@/components/ui/input-icon";
import { Button } from "@/components/ui/button";
import { MdCallSplit, MdExpandMore } from "react-icons/md";
import {
  formatCurrency,
  formatYearMonth,
  formatDate,
  formatDateTime,
  LOCALE,
} from "@/lib/constants";
import { useAppContext } from "@/components/layout/app-layout";
import { maskIban, txDisplayDate } from "@/lib/bank-utils";
import { guessCategory } from "@/lib/split-utils";
import {
  QuickAddSplitModal,
  type QuickAddSplitInitial,
} from "@/components/split/quick-add-split-modal";
import type { BankSplitMatch } from "@/lib/bank-split-match";
import type {
  BankTransaction,
  Currency,
  BankTransactionStatus,
  SplitExpense,
} from "@/types";

const STATUS_TIP: Record<BankTransactionStatus, string> = {
  booked:
    "Booked — settled and final; it appears on your statement and won’t change.",
  pending:
    "Pending — authorized but not yet settled. The amount or date can still change, and it may merge into a booked entry later.",
  other: "Other — the bank didn’t mark this entry as booked or pending.",
};

function statusSeverity(
  s: BankTransactionStatus,
): "success" | "warning" | "info" {
  return s === "booked" ? "success" : s === "pending" ? "warning" : "info";
}

/** Compact status dot color for the mobile row (green/amber/gray, no label). */
function statusDotClass(s: BankTransactionStatus): string {
  return s === "booked"
    ? "bg-green-500"
    : s === "pending"
      ? "bg-amber-500"
      : "bg-border";
}

/** Format a date string that may or may not carry a time component. */
function fmtDateTime(value: string): { date: string; time: string | null } {
  const hasTime = value.length > 10 || value.includes("T");
  const d = new Date(hasTime ? value : `${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { date: value, time: null };
  const date = formatDate(d);
  const time = hasTime
    ? d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })
    : null;
  return { date, time };
}

/** How many month sections the mobile list shows initially / adds per load. */
const INITIAL_MONTHS = 3;
const MONTHS_STEP = 6;
const INITIAL_ROWS = 50;
const ROWS_STEP = 50;

/**
 * Case-insensitive match on counterparty, remittance info, the structured
 * reference number (Finnish viitenumero — how an invoice is usually looked up),
 * or amount digits.
 */
function matchesQuery(t: BankTransaction, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (t.counterpartyName?.toLowerCase().includes(needle)) return true;
  if (t.remittanceInfo?.toLowerCase().includes(needle)) return true;
  if (t.referenceNumber?.toLowerCase().includes(needle)) return true;
  // Amount search: compare against both '.'- and ','-decimal renderings.
  const abs = Math.abs(t.amount);
  if (abs.toFixed(2).includes(needle.replace(",", "."))) return true;
  return false;
}

/** "Already split" flag — a small pill, filled when the expense was created
 * from this exact transaction ("Split this"), dashed/outlined when it's only a
 * same-amount/nearby-date heuristic guess. Tapping deep-links into the split
 * group, landing on the matched expense's month. */
function SplitFlag({
  match,
  txDate,
  onReview,
}: {
  match: BankSplitMatch;
  txDate: string;
  onReview?: () => void;
}) {
  const router = useRouter();
  const isLinked = match.kind === "linked";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (
          (match.kind !== "linked" || (match.related?.length ?? 0) > 0) &&
          onReview
        ) {
          onReview();
          return;
        }
        const month = match.date.slice(0, 7) || txDate.slice(0, 7);
        router.push(
          `/split/${match.groupId}?expense=${match.expenseId}&month=${month}`,
        );
      }}
      title={
        isLinked
          ? `Split in ${match.groupName}`
          : `Possibly already split in ${match.groupName}`
      }
      className={`inline-flex min-h-[44px] min-w-[44px] justify-center items-center gap-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${
        isLinked
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "border border-dashed border-border text-muted-foreground"
      }`}
    >
      <MdCallSplit className="text-[11px]" />
      {isLinked ? "split" : "split?"}
      {match.related?.length ? ` · ${match.related.length + 1}` : ""}
    </button>
  );
}

/** Read-only transaction ledger for one linked bank account. Desktop: a
 * scrollable TanStack table with expandable detail rows.
 * Mobile: month-grouped sections with sticky headers + "Load older months"
 * (the split ledger pattern) so one account can't inflate the page to
 * thousands of pixels. Each mobile list row has an explicit keyboard details
 * button and also toggles on a pointer click outside its action buttons. The row
 * leads with a stacked date column (month initials over day number, matching
 * the split detail rows), then a single title+remittance text column so a
 * second remittance line adds height only to that column, never to the
 * button-bearing first line. The flag pill and "Split this" button sit
 * BETWEEN that text column and the amount (both stop click propagation) so
 * the amount + chevron form a constant-width right rail and every row's
 * amount right-aligns at the same x-position. Both views
 * share a counterparty/amount search box and an "already split" flag from
 * `splitMatches` (see src/lib/bank-split-match.ts). */
export function BankLedgerTable({
  transactions,
  currency,
  linkedAccountId,
  bankName,
  splitMatches,
  onSplitSaved,
  onConfirmSplitSuggestion,
  highlightTxId,
}: {
  transactions: BankTransaction[];
  currency: Currency;
  linkedAccountId: string;
  bankName: string;
  splitMatches?: Map<string, BankSplitMatch>;
  onSplitSaved?: (
    expense?: SplitExpense,
    group?: { id: string; name: string },
  ) => void;
  onConfirmSplitSuggestion?: (
    tx: BankTransaction,
    match: BankSplitMatch,
  ) => Promise<void> | void;
  highlightTxId?: string;
}) {
  const router = useRouter();
  const demoMasked = useAppContext()?.demoMasked ?? false;
  const [expanded, setExpanded] = useState<DataTableExpandedRows>({});
  const [expandedMobile, setExpandedMobile] = useState<Record<string, boolean>>(
    {},
  );
  const [query, setQuery] = useState("");
  const [visibleMonths, setVisibleMonths] = useState(INITIAL_MONTHS);
  const [visibleRows, setVisibleRows] = useState(INITIAL_ROWS);
  // "Split this" — quick-add split dialog prefilled from a spend transaction.
  const [splitInitial, setSplitInitial] = useState<QuickAddSplitInitial | null>(
    null,
  );
  const [reviewConfirm, setReviewConfirm] = useState<
    ((match: BankSplitMatch) => Promise<void> | void) | undefined
  >();

  const openSplitFor = (t: BankTransaction) => {
    const title = t.counterpartyName ?? t.remittanceInfo?.split("\n")[0] ?? "";
    setSplitInitial({
      title,
      amount: Math.abs(t.amount),
      date: txDisplayDate(t), // prefill with the purchase date, not the booking date
      category: guessCategory(title),
      bankLink: {
        txId: t.id,
        linkedAccountId,
        bookingDate: t.bookingDate.slice(0, 10),
        amount: t.amount,
        currency: t.currency,
        counterpartyName: t.counterpartyName,
        bankName,
      },
    });
  };

  const openReviewFor = (t: BankTransaction, match: BankSplitMatch) => {
    setReviewConfirm(() =>
      onConfirmSplitSuggestion
        ? (candidate: BankSplitMatch) => onConfirmSplitSuggestion(t, candidate)
        : undefined,
    );
    setSplitInitial({
      reviewMatch: match,
      date: txDisplayDate(t),
      bankLink: {
        txId: t.id,
        linkedAccountId,
        bookingDate: t.bookingDate.slice(0, 10),
        amount: t.amount,
        currency: t.currency,
        counterpartyName: t.counterpartyName,
        bankName,
      },
    });
  };

  // Filtered, then re-sorted descending by the displayed (purchase) date: the
  // incoming array is bookingDate-sorted, but a purchase can date up to a few
  // days before its booking, so rendering it in bookingDate order would show
  // rows out of order. `dedupKey` breaks ties so same-day rows keep a stable,
  // deterministic order across renders.
  const filtered = useMemo(
    () =>
      transactions
        .filter((t) => matchesQuery(t, query.trim()))
        .slice()
        .sort(
          (a, b) =>
            txDisplayDate(b).localeCompare(txDisplayDate(a)) ||
            b.dedupKey.localeCompare(a.dedupKey),
        ),
    [transactions, query],
  );

  // Keep asynchronously resolved split-match metadata on each desktop row so
  // cell rendering and the mobile list consume the same match result.
  type LedgerRow = BankTransaction & { _splitMatch?: BankSplitMatch };
  const desktopRows = useMemo<LedgerRow[]>(
    () => filtered.map((t) => ({ ...t, _splitMatch: splitMatches?.get(t.id) })),
    [filtered, splitMatches],
  );

  // Month-grouped (desc) for the mobile list.
  const byMonth = useMemo(() => {
    const map = new Map<string, BankTransaction[]>();
    for (const t of filtered) {
      const ym = txDisplayDate(t).slice(0, 7);
      const arr = map.get(ym) ?? [];
      arr.push(t);
      map.set(ym, arr);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);
  const visibleByMonth = byMonth.slice(0, visibleMonths);

  // Desktop infinite scroll: reveal more rows when the DataTable's inner
  // explicitly referenced scroll viewport nears
  // its end. Listener re-binds per selected account (the wrapper node is
  // recreated) via the transactions dep.
  const desktopWrapRef = useRef<HTMLDivElement | null>(null);
  const desktopScrollRef = useRef<HTMLDivElement | null>(null);
  const visibleRowsRef = useRef(visibleRows);
  visibleRowsRef.current = visibleRows;
  useEffect(() => {
    const scroller = desktopScrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      if (
        scroller.scrollTop + scroller.clientHeight <
        scroller.scrollHeight - 300
      )
        return;
      if (visibleRowsRef.current >= filtered.length) return;
      setVisibleRows((v) => Math.min(v + ROWS_STEP, filtered.length));
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [transactions, filtered.length, demoMasked]);

  // Mobile infinite scroll: auto-load older months when the sentinel below the
  // list enters the viewport (the mobile list scrolls with the page, not an
  // inner container). The "Load older months" button stays as a fallback.
  const mobileSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = mobileSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleMonths((v) => (v < byMonth.length ? v + MONTHS_STEP : v));
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
    // visibleMonths dep: re-observe after each reveal so a sentinel that is
    // STILL in view (tall viewport) fires again — IntersectionObserver only
    // reports intersection *changes*.
  }, [byMonth.length, visibleMonths]);

  // Deep-link highlight (?tx=): scroll + flash the matching row on both the
  // mobile list and the desktop table, expanding whichever is visible and
  // paging/loading-more months as needed. Runs once per highlightTxId value —
  // completion (not entry) marks `highlightedOnceRef`, so React 18 dev-mode's
  // mount→cleanup→mount double-invoke (which cancels the first run's pending
  // timeout) doesn't leave the second, kept invocation bailing out early
  // before the scroll/flash/URL-strip ever actually runs.
  const highlightedOnceRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!highlightTxId) {
      // Param consumed/cleared — allow a later navigation to the same tx to
      // trigger a fresh highlight.
      highlightedOnceRef.current = undefined;
      return;
    }
    if (highlightedOnceRef.current === highlightTxId) return;
    const tx = transactions.find((t) => t.id === highlightTxId);
    if (!tx) return;

    const ym = txDisplayDate(tx).slice(0, 7);
    const monthIdx = byMonth.findIndex(([m]) => m === ym);
    if (monthIdx >= 0 && monthIdx >= visibleMonths)
      setVisibleMonths(monthIdx + 1);
    setExpandedMobile((m) => ({ ...m, [tx.id]: true }));

    const idx = filtered.findIndex((t) => t.id === highlightTxId);
    if (idx >= 0) setVisibleRows((v) => Math.max(v, idx + 1 + ROWS_STEP / 2));
    setExpanded((prev) => {
      const base =
        prev && typeof prev === "object" && !Array.isArray(prev)
          ? (prev as DataTableExpandedRows)
          : {};
      return { ...base, [tx.id]: true };
    });

    // Give the state updates above (month/page reveal) a tick to render before
    // locating the row in the DOM. Both the mobile <li> and the desktop <tr>
    // carry the same `bank-tx-row-{id}` class — only one is ever laid out
    // (the other is `display:none` via the lg breakpoint), so `offsetParent`
    // picks the visible one. Polls briefly (rather than a single fixed delay)
    // since the DataTable's own re-render after expanding/paging can lag a
    // tick behind our state update. The URL strip (router.replace) happens
    // only once this settles — calling it immediately, while Next's App
    // Router is still reconciling the just-completed hard navigation, can
    // get silently dropped/overwritten.
    let cancelled = false;
    let attempts = 0;
    const finish = () => {
      if (cancelled) return;
      highlightedOnceRef.current = highlightTxId;
      router.replace(`/bank?account=${linkedAccountId}`, { scroll: false });
    };
    const tryScroll = () => {
      if (cancelled) return;
      const nodes = document.querySelectorAll(`.bank-tx-row-${tx.id}`);
      let el: HTMLElement | null = null;
      nodes.forEach((n) => {
        if (!el && (n as HTMLElement).offsetParent !== null)
          el = n as HTMLElement;
      });
      if (el) {
        (el as HTMLElement).scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
        (el as HTMLElement).classList.add("flash-highlight");
        setTimeout(
          () => (el as HTMLElement).classList.remove("flash-highlight"),
          2000,
        );
        finish();
        return;
      }
      attempts += 1;
      if (attempts < 30) setTimeout(tryScroll, 100);
      else finish(); // give up finding the row, but still clean up the URL
    };
    const t0 = setTimeout(tryScroll, 100);

    return () => {
      cancelled = true;
      clearTimeout(t0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightTxId, transactions]);

  if (transactions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No transactions cached yet — try Refresh now in Settings.
      </p>
    );
  }

  const dateBody = (t: BankTransaction) => {
    const { date, time } = fmtDateTime(txDisplayDate(t));
    return (
      <div className="whitespace-nowrap">
        <div>{date}</div>
        {time && <div className="text-xs text-muted-foreground">{time}</div>}
      </div>
    );
  };

  const counterpartyBody = (t: BankTransaction) => (
    <div className="min-w-[12rem]">
      <div className="font-medium text-sm">{t.counterpartyName ?? "—"}</div>
      {t.remittanceInfo && (
        <div className="text-xs text-muted-foreground whitespace-pre-line">
          {t.remittanceInfo}
        </div>
      )}
      {t.bankTransactionCode && (
        <div className="text-xs text-muted-foreground italic mt-0.5">
          {t.bankTransactionCode}
        </div>
      )}
    </div>
  );

  const amountBody = (t: BankTransaction) => (
    <span
      className={
        t.amount < 0 ? "text-red-500 font-medium" : "text-green-600 font-medium"
      }
    >
      {formatCurrency(t.amount, currency)}
    </span>
  );

  // The native title offers a hover hint; the expandable row repeats its
  // complete meaning for touch and keyboard users.
  // The full meaning is also repeated in the expandable row for touch devices,
  // where no hover tooltip can ever show.
  const statusBody = (t: BankTransaction) => (
    <span className="cursor-help" title={STATUS_TIP[t.status]}>
      <Tag value={t.status} severity={statusSeverity(t.status)} />
    </span>
  );

  const splitFlagBody = (
    t: BankTransaction & { _splitMatch?: BankSplitMatch },
  ) => {
    const match = t._splitMatch ?? splitMatches?.get(t.id);
    return match ? (
      <SplitFlag
        match={match}
        txDate={txDisplayDate(t)}
        onReview={() => openReviewFor(t, match)}
      />
    ) : null;
  };

  const detailRow = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="flex gap-2">
        <span className="text-muted-foreground w-40 shrink-0">{label}</span>
        <span className="break-all">{value}</span>
      </div>
    ) : null;

  const rowExpansion = (t: BankTransaction) => (
    <div className="px-4 py-3 text-xs space-y-1 bg-muted">
      {/* Repeat the status with its full meaning here: hover tooltips don't
          exist on touch devices, but the row expands on tap. */}
      <div className="flex gap-2">
        <span className="text-muted-foreground w-40 shrink-0">Status</span>
        <span>{STATUS_TIP[t.status]}</span>
      </div>
      {/* Always shown: the row can now display the purchase date instead of
          the booking date (see txDisplayDate), so the true booking date must
          stay inspectable here. */}
      {detailRow("Booking date", t.bookingDate)}
      {detailRow("Value date", t.valueDate)}
      {detailRow("Transaction date", t.transactionDate)}
      {detailRow(
        "Counterparty account",
        maskIban(t.counterpartyAccount) || undefined,
      )}
      {detailRow("Bank transaction type", t.bankTransactionCode)}
      {detailRow("Merchant category", t.merchantCategoryCode)}
      {detailRow(
        "Balance after",
        typeof t.balanceAfter === "number"
          ? formatCurrency(t.balanceAfter, currency)
          : undefined,
      )}
      {detailRow("Note", t.note)}
      {detailRow("Bank reference", t.entryReference)}
      {detailRow(
        "Reference number",
        t.referenceNumber
          ? t.referenceNumberSchema
            ? `${t.referenceNumber} (${t.referenceNumberSchema})`
            : t.referenceNumber
          : undefined,
      )}
      <div className="flex gap-2">
        <span className="text-muted-foreground w-40 shrink-0">First seen</span>
        <span>{formatDateTime(t.firstSeenAt)}</span>
      </div>
      {t.amount < 0 && (
        <div className="pt-2">
          <Button
            label="Split this"
            icon={<MdCallSplit />}
            size="small"
            outlined
            onClick={() => openSplitFor(t)}
          />
        </div>
      )}
    </div>
  );

  // Desktop row action: spend rows (amount < 0) can be sent to the split
  // quick-add dialog prefilled. Native `title` for the hint (see statusBody).
  const splitActionBody = (t: BankTransaction) =>
    t.amount < 0 ? (
      <Button
        icon={<MdCallSplit />}
        text
        size="small"
        className="!p-1"
        title="Split this in a split group"
        aria-label="Split this"
        onClick={() => openSplitFor(t)}
      />
    ) : null;

  return (
    <>
      {/* Search — counterparty, description, or amount */}
      <MaterialToolbar aria-label="Transaction search" className="mb-3">
        <IconField iconPosition="left" className="w-full">
          <InputIcon>
            <Search size={16} />
          </InputIcon>
          <InputText
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisibleMonths(INITIAL_MONTHS);
              setVisibleRows(INITIAL_ROWS);
            }}
            placeholder="Search counterparty or amount…"
            // Reserve room for the icon and keep mobile inputs at16px to avoid iOS zoom.
            className="w-full !pl-10 !text-base lg:!text-sm"
            aria-label="Search transactions"
          />
        </IconField>
        {query.trim() && (
          <p className="text-xs text-muted-foreground mt-1">
            {filtered.length} of {transactions.length} transactions match
          </p>
        )}
      </MaterialToolbar>

      {/* Desktop: full DataTable — infinite scroll (rows revealed as the inner
          scroll area approaches its end) instead of a paginator. All data is
          already client-side; reveal in batches while keeping expanded rows
          at their natural height. */}
      <div className="hidden lg:block" ref={desktopWrapRef}>
        <DataTable
          // Remount when demo mode flips: DataTable's memoized internals keep
          // stale formatCurrency output across re-renders otherwise.
          key={demoMasked ? "masked" : "plain"}
          value={desktopRows.slice(0, visibleRows)}
          scrollable
          scrollRef={desktopScrollRef}
          showColumnVisibility
          scrollHeight="60vh"
          size="small"
          stripedRows
          dataKey="id"
          expandedRows={expanded}
          onRowToggle={(e) => setExpanded(e.data)}
          rowExpansionTemplate={rowExpansion}
          rowClassName={(rowData) => `bank-tx-row-${rowData.id}`}
        >
          <Column
            header={<span className="sr-only">Details</span>}
            expander
            style={{ width: "4.5rem" }}
          />
          <Column
            hideable
            header="Date"
            body={dateBody}
            style={{ width: "8rem" }}
          />
          <Column
            header="Counterparty / details"
            body={counterpartyBody}
            style={{ minWidth: "14rem" }}
          />
          <Column
            header="Amount"
            body={amountBody}
            style={{ width: "9rem" }}
            align="right"
          />
          <Column
            hideable
            header="Split"
            body={splitFlagBody}
            style={{ width: "6rem" }}
          />
          <Column
            hideable
            header="Status"
            body={statusBody}
            style={{ width: "7rem" }}
          />
          <Column
            header={<span className="sr-only">Actions</span>}
            body={splitActionBody}
            style={{ width: "4.5rem" }}
          />
        </DataTable>
        <p className="px-1 text-xs text-muted-foreground text-right mt-2">
          {visibleRows < filtered.length
            ? `Showing ${Math.min(visibleRows, filtered.length)} of ${filtered.length} — scroll for more`
            : `${filtered.length} transactions`}
        </p>
      </div>

      {/* Mobile: static month headings stay below the sticky picker; older groups load incrementally. */}
      <div className="lg:hidden space-y-3">
        {visibleByMonth.map(([ym, rows]) => (
          <div key={ym} className="rounded-2xl border border-border bg-card p-3">
            <h2 data-slot="bank-month-heading" className="mb-2 rounded-xl border border-border bg-muted px-3 py-3 text-sm font-semibold tracking-tight text-foreground">
              {formatYearMonth(ym)}
            </h2>
            <ul className="divide-y divide-border">
              {rows.map((t) => {
                const open = !!expandedMobile[t.id];
                const match = splitMatches?.get(t.id);
                const displayTitle =
                  t.counterpartyName ?? t.remittanceInfo?.split("\n")[0] ?? "—";
                const remittanceLine = t.remittanceInfo?.split("\n")[0];
                const hasLine2 =
                  !!remittanceLine && remittanceLine !== displayTitle;
                return (
                  <li
                    key={t.id}
                    onClick={() =>
                      setExpandedMobile((m) => ({ ...m, [t.id]: !m[t.id] }))
                    }
                    className={`flex flex-wrap items-center min-h-[44px] px-2 py-1.5 cursor-pointer transition-colors hover:bg-muted active:bg-muted bank-tx-row-${t.id}`}
                  >
                    <div className="flex w-full min-w-0 items-center gap-2">
                      {/* Stacked date column — same style as the split detail rows */}
                      <div className="w-9 shrink-0 text-center">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground leading-tight">
                          {format(parseISO(txDisplayDate(t)), "MMM")}
                        </div>
                        <div className="text-base font-medium text-muted-foreground leading-tight">
                          {format(parseISO(txDisplayDate(t)), "d")}
                        </div>
                      </div>
                      {/* Title + optional remittance share one column so the trailing
                          buttons center across both lines instead of inflating line 1. */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass(t.status)}`}
                            title={STATUS_TIP[t.status]}
                          >
                            <span className="sr-only">{t.status}</span>
                          </span>
                          <span className="truncate text-sm font-medium leading-snug">
                            {displayTitle}
                          </span>
                        </div>
                        {hasLine2 && (
                          <div className="truncate text-xs text-muted-foreground leading-snug pl-4">
                            {remittanceLine}
                          </div>
                        )}
                      </div>
                      {/* Variable-width extras stay BETWEEN the text and the amount so the
                          amount + chevron remain a constant-width right rail (aligned amounts). */}
                      {match && (
                        <SplitFlag
                          match={match}
                          txDate={txDisplayDate(t)}
                          onReview={() => openReviewFor(t, match)}
                        />
                      )}
                      {t.amount < 0 && (
                        <Button
                          icon={<MdCallSplit />}
                          text
                          size="small"
                          className="!w-9 !h-9 shrink-0"
                          aria-label="Split this"
                          onClick={(e) => {
                            e.stopPropagation();
                            openSplitFor(t);
                          }}
                        />
                      )}
                      <button
                        type="button"
                        className="flex min-h-11 shrink-0 items-center gap-1 rounded text-right"
                        aria-label={`${open ? "Hide" : "Show"} details for ${displayTitle}, ${formatCurrency(t.amount, currency)}`}
                        aria-expanded={open}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedMobile((m) => ({
                            ...m,
                            [t.id]: !m[t.id],
                          }));
                        }}
                      >
                        <span
                          className={`tabular-nums text-sm font-medium ${t.amount < 0 ? "text-red-500" : "text-green-600"}`}
                        >
                          {formatCurrency(t.amount, currency)}
                        </span>
                        <MdExpandMore
                          aria-hidden
                          className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                        />
                      </button>
                    </div>
                    {open && (
                      <div
                        className="basis-full cursor-auto"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {rowExpansion(t)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div ref={mobileSentinelRef} aria-hidden className="h-px" />
        {byMonth.length > visibleMonths && (
          <div className="text-center">
            <Button
              label="Load older months"
              text
              size="small"
              onClick={() => setVisibleMonths((v) => v + MONTHS_STEP)}
            />
          </div>
        )}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No transactions match your search.
          </p>
        )}
      </div>

      {/* "Split this" — self-contained quick-add dialog, prefilled from the row */}
      <QuickAddSplitModal
        visible={!!splitInitial}
        onHide={() => {
          setSplitInitial(null);
          setReviewConfirm(undefined);
        }}
        onSaved={onSplitSaved}
        initial={splitInitial ?? undefined}
        onConfirmLink={reviewConfirm}
      />
    </>
  );
}
