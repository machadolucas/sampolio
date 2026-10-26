import type { WealthProjectionMonth } from '@/types';

export type WealthScope = 'liquid' | 'total';

/**
 * Single source of truth for wealth-category colors (RGB triples, no alpha) —
 * shared by WealthChart and NetWorthChart so the breakdown bars, the net
 * worth overlay/line, and the tooltip text never disagree on what color means
 * what. Use `rgb()`/`rgba()` below to render a given category.
 */
export const WEALTH_COLORS = {
  netWorth: '59, 130, 246', // blue
  cash: '34, 197, 94', // green
  investments: '168, 85, 247', // purple
  receivables: '20, 184, 166', // teal
  homeValue: '245, 158, 11', // amber
  debts: '239, 68, 68', // red
  cards: '244, 63, 94', // rose
  mortgage: '120, 53, 15', // deep brown — distinct from debts red
  split: '99, 102, 241', // indigo — split balances (distribution card only)
} as const;

export function rgb(key: keyof typeof WEALTH_COLORS): string {
  return `rgb(${WEALTH_COLORS[key]})`;
}

export function rgba(key: keyof typeof WEALTH_COLORS, alpha: number): string {
  return `rgba(${WEALTH_COLORS[key]}, ${alpha})`;
}

interface WealthCategory {
  key: keyof typeof WEALTH_COLORS;
  label: string;
  stack: 'assets' | 'liabilities';
  value: (m: WealthProjectionMonth) => number;
}

// Total-scope categories: every asset/liability that folds into full net worth.
const TOTAL_CATEGORIES: WealthCategory[] = [
  {
    key: 'cash',
    label: 'Cash',
    stack: 'assets',
    value: (m) => m.cashAccountsTotal,
  },
  {
    key: 'investments',
    label: 'Investments',
    stack: 'assets',
    value: (m) => m.investmentsTotal,
  },
  {
    key: 'receivables',
    label: 'Receivables',
    stack: 'assets',
    value: (m) => m.receivablesTotal,
  },
  {
    key: 'homeValue',
    label: 'Home value',
    stack: 'assets',
    value: (m) => m.mortgageStakeTotal ?? 0,
  },
  {
    key: 'debts',
    label: 'Debts',
    stack: 'liabilities',
    value: (m) => -m.debtsTotal,
  },
  {
    key: 'cards',
    label: 'Credit cards',
    stack: 'liabilities',
    value: (m) => -(m.cardLiabilitiesTotal ?? 0),
  },
  {
    key: 'mortgage',
    label: 'Mortgage',
    stack: 'liabilities',
    value: (m) => -(m.mortgageLiabilityTotal ?? 0),
  },
];

// Liquid-scope categories: cash + investments net of debts and card liabilities.
const LIQUID_CATEGORIES: WealthCategory[] = [
  {
    key: 'cash',
    label: 'Cash',
    stack: 'assets',
    value: (m) => m.cashAccountsTotal,
  },
  {
    key: 'investments',
    label: 'Investments',
    stack: 'assets',
    value: (m) => m.investmentsTotal,
  },
  {
    key: 'debts',
    label: 'Debts',
    stack: 'liabilities',
    value: (m) => -m.debtsTotal,
  },
  {
    key: 'cards',
    label: 'Credit cards',
    stack: 'liabilities',
    value: (m) => -(m.cardLiabilitiesTotal ?? 0),
  },
];

/** The breakdown categories for a scope, shared by WealthChart's stacked bars
 *  and NetWorthChart's tooltip breakdown. */
export function wealthCategoriesForScope(scope: WealthScope): WealthCategory[] {
  return scope === 'total' ? TOTAL_CATEGORIES : LIQUID_CATEGORIES;
}

/** Net worth for a given month, following the scope toggle: 'total' is the
 *  full net worth (incl. mortgage equity + split balance); 'liquid' is cash +
 *  investments net of debts and card liabilities. Shared with NetWorthChart
 *  so both views always agree on the number. */
export function computeScopedNetWorth(
  m: WealthProjectionMonth,
  scope: WealthScope,
): number {
  if (scope === 'total') return m.netWorth;
  return (
    m.cashAccountsTotal +
    m.investmentsTotal -
    m.debtsTotal -
    (m.cardLiabilitiesTotal ?? 0)
  );
}
