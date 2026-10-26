"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { useAppContext } from "@/components/layout/app-layout";
import { formatCurrency } from "@/lib/constants";
import type { FinancialAccount, Currency } from "@/types";
import {
  MdAdd,
  MdRemove,
  MdList,
  MdAccountBalanceWallet,
} from "react-icons/md";
import { MonthStrip } from "./month-strip";

interface CashflowHeaderProps {
  accounts: FinancialAccount[];
  selectedAccountId: string;
  onSelectAccount: (id: string) => void;
  /** Current balance per account id (for the selector affordance). */
  accountBalances: Map<string, number>;
  months: string[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  reconciledMonths: Set<string>;
  actualMonths: Set<string>;
  addDisabled: boolean;
  onAddItem: (type: "income" | "expense") => void;
  onManageItems: () => void;
}

/**
 * The cashflow page's sticky header: title, account selector, actions, and
 * the month strip. On mobile it COLLAPSES on scroll to a slim bar (compact
 * month strip + account chip) so ~330px of chrome doesn't eat half the
 * viewport; scrolling back to the top restores the full header. Desktop
 * (lg+) never collapses.
 */
export function CashflowHeader({
  accounts,
  selectedAccountId,
  onSelectAccount,
  accountBalances,
  months,
  selectedMonth,
  onSelectMonth,
  reconciledMonths,
  actualMonths,
  addDisabled,
  onAddItem,
  onManageItems,
}: CashflowHeaderProps) {
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);

  // Collapse after scrolling a bit; expand near the top. Hysteresis (140 down
  // / 24 up) prevents flapping around the threshold, and rAF-throttling keeps
  // the listener cheap. CSS `lg:` overrides keep desktop unaffected.
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        const next = collapsedRef.current ? y > 24 : y > 140;
        if (next !== collapsedRef.current) {
          collapsedRef.current = next;
          setCollapsed(next);
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const demoMasked = useAppContext()?.demoMasked ?? false;
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const balance = accountBalances.get(selectedAccountId);
  const balanceLabel = (id: string) => {
    const b = accountBalances.get(id);
    const acct = accounts.find((a) => a.id === id);
    return typeof b === "number" && acct
      ? formatCurrency(b, acct.currency as Currency)
      : null;
  };

  const accountOption = (opt: { label: string; value: string }) => (
    <span className="flex items-center gap-2 min-w-0">
      <MdAccountBalanceWallet className="opacity-60 shrink-0" />
      <span className="truncate">{opt.label}</span>
      {balanceLabel(opt.value) && (
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          · {balanceLabel(opt.value)}
        </span>
      )}
    </span>
  );

  return (
    <div
      data-slot="cashflow-sticky"
      data-collapsed={collapsed}
      className="sticky top-[calc(4.5rem+env(safe-area-inset-top))] lg:top-[calc(0.5rem+env(safe-area-inset-top))] z-30 py-2"
    >
      <div
        data-slot="cashflow-toolbar"
        role="region"
        aria-label="Cashflow controls"
        className={`glass-chrome max-w-360 mx-auto rounded-2xl border px-3 sm:px-4 ${collapsed ? "py-1.5 lg:py-3" : "py-3"}`}
      >
        {/* Full header row — scrolls away on mobile when collapsed. */}
        <div
          className={`${collapsed ? "hidden lg:flex" : "flex"} flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3`}
        >
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
              Cashflow
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Track income and expenses for your cash accounts
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Dropdown
              // Recreate the selected-value template when money masking changes.
              key={demoMasked ? "masked" : "plain"}
              value={selectedAccountId}
              aria-label="Cash account"
              options={accounts.map((a) => ({ label: a.name, value: a.id }))}
              onChange={(e) => {
                if (e.value !== null) onSelectAccount(e.value);
              }}
              placeholder="Select Account"
              itemTemplate={accountOption}
              valueTemplate={(opt) =>
                opt ? accountOption(opt) : <span>Select Account</span>
              }
              className="w-full sm:w-64"
            />
            <Button
              label="Add Income"
              icon={<MdAdd />}
              severity="success"
              size="small"
              outlined
              className="flex-1 sm:flex-none"
              disabled={addDisabled}
              tooltip={
                addDisabled
                  ? "Past months show real bank data and cannot be edited"
                  : undefined
              }
              onClick={() => onAddItem("income")}
            />
            <Button
              label="Add Expense"
              icon={<MdRemove />}
              severity="danger"
              size="small"
              outlined
              className="flex-1 sm:flex-none"
              disabled={addDisabled}
              tooltip={
                addDisabled
                  ? "Past months show real bank data and cannot be edited"
                  : undefined
              }
              onClick={() => onAddItem("expense")}
            />
            <Button
              label="View all items"
              icon={<MdList />}
              severity="secondary"
              outlined
              size="small"
              className="flex-1 sm:flex-none"
              onClick={onManageItems}
            />
          </div>
        </div>

        {/* Collapsed mobile bar: account chip only (the compact strip below keeps months). */}
        {collapsed && selectedAccount && (
          <div className="flex lg:hidden items-center gap-2 px-2 pt-1 text-sm">
            <MdAccountBalanceWallet className="opacity-60 shrink-0" />
            <span className="font-medium truncate text-foreground">
              {selectedAccount.name}
            </span>
            {typeof balance === "number" && (
              <span className="text-muted-foreground whitespace-nowrap">
                ·{" "}
                {formatCurrency(balance, selectedAccount.currency as Currency)}
              </span>
            )}
          </div>
        )}

        {/* Month strip — compact (no year row) when collapsed on mobile. */}
        <div className={collapsed ? "lg:hidden" : "hidden"}>
          <MonthStrip
            months={months}
            selectedMonth={selectedMonth}
            onSelectMonth={onSelectMonth}
            reconciledMonths={reconciledMonths}
            actualMonths={actualMonths}
            compact
          />
        </div>
        <div className={collapsed ? "hidden lg:block" : "block"}>
          <MonthStrip
            months={months}
            selectedMonth={selectedMonth}
            onSelectMonth={onSelectMonth}
            reconciledMonths={reconciledMonths}
            actualMonths={actualMonths}
          />
        </div>
      </div>
    </div>
  );
}
