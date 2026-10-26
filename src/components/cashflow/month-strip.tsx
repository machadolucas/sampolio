"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useReducedMotion } from '@/lib/hooks/use-reduced-motion';
import { MONTHS, MONTHS_SHORT } from "@/lib/constants";
import { MdCheckCircle, MdHistory } from "react-icons/md";

interface MonthStripProps {
  months: string[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  reconciledMonths?: Set<string>;
  actualMonths?: Set<string>;
  /** Slim variant for the collapsed mobile header: no year row, tighter cells. */
  compact?: boolean;
}

export function MonthStrip({
  months,
  selectedMonth,
  onSelectMonth,
  reconciledMonths = new Set(),
  actualMonths = new Set(),
  compact = false,
}: MonthStripProps) {
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasCenteredRef = useRef(false);

  // Center the selected month within the strip — instantly on first load (so the
  // current month, selected by default, starts centered), smoothly on later
  // selections. Clamps to the start, so when there aren't enough earlier months
  // to fill the left half the month sits left-of-center instead of forcing an
  // impossible scroll. Only the strip container scrolls — never the page.
  //
  // Bails without marking success when the container isn't measurable yet (e.g.
  // this instance is the compact/collapsed strip currently hidden via CSS
  // `display:none` — clientWidth/getBoundingClientRect both read 0 there). A
  // ResizeObserver below retries once the container actually gets laid out.
  const centerSelected = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return false;
    if (container.clientWidth === 0 || container.offsetParent === null)
      return false;
    const el = container.querySelector(
      `[data-month="${selectedMonth}"]`,
    ) as HTMLElement | null;
    if (!el) return false;
    const elLeft =
      el.getBoundingClientRect().left -
      container.getBoundingClientRect().left +
      container.scrollLeft;
    const target = Math.max(
      0,
      elLeft - (container.clientWidth - el.clientWidth) / 2,
    );
    container.scrollTo({
      left: target,
      behavior: hasCenteredRef.current && !reducedMotion ? "smooth" : "auto",
    });
    hasCenteredRef.current = true;
    return true;
  }, [selectedMonth, reducedMotion]);

  // Depends on months.length so it fires once the month list loads (the initial
  // centering would otherwise be missed).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      centerSelected();
    });
    return () => cancelAnimationFrame(id);
  }, [centerSelected, months.length, compact]);

  // Covers the case above: if the strip was hidden (display:none) when the
  // centering effect ran, it never got a real width to measure and bailed out.
  // Once the container is actually laid out (e.g. the header collapses and the
  // compact strip becomes visible), re-attempt centering — but only until the
  // first attempt actually succeeds; after that, never fight the user's manual
  // scrolling just because the container resized.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (hasCenteredRef.current) return;
      centerSelected();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [centerSelected]);

  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  return (
    <div
      ref={scrollRef}
      data-slot="cashflow-month-strip"
      className={`flex gap-2 overflow-x-auto ${compact ? "py-1.5" : "py-2"} px-1 scrollbar-thin`}
    >
      {months.map((month) => {
        const [year, m] = month.split("-");
        const isSelected = month === selectedMonth;
        const isCurrent = month === currentMonth;
        const isReconciled = reconciledMonths.has(month);
        const isActual = actualMonths.has(month);

        return (
          <button
            key={month}
            data-month={month}
            onClick={() => onSelectMonth(month)}
            aria-current={isSelected ? "true" : undefined}

            title={`${MONTHS[parseInt(m) - 1]} ${year}${isActual ? " — actual from real bank transactions" : isReconciled ? " — reconciled" : ""}`}
            className={`shrink-0 ${compact ? "px-2.5 py-1" : "px-4 py-2"} min-h-11 rounded-lg transition active:scale-95 ${
              isSelected
                ? "bg-primary text-primary-foreground"
                : isActual
                  ? "bg-card text-muted-foreground border border-dashed border-border hover:bg-accent"
                  : isCurrent
                    ? "bg-accent text-accent-foreground border border-primary/30"
                    : "bg-muted text-foreground hover:bg-accent"
            }`}
          >
            {!compact && <div className="text-xs">{year}</div>}
            <div className={`font-medium ${compact ? "text-sm" : ""}`}>
              {MONTHS_SHORT[parseInt(m) - 1]}
              {compact && <span className="ml-1 text-xs">{year.slice(2)}</span>}
            </div>
            {!compact && (isReconciled || isActual) && (
              <div className="flex justify-center mt-1">
                {isActual ? (
                  <MdHistory
                    className={
                      isSelected ? "text-current" : "text-muted-foreground"
                    }
                    size={12}
                  />
                ) : (
                  <MdCheckCircle className="text-green-500" size={12} />
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
