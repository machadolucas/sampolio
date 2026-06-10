import type { Currency } from '@/types';

// Single source of truth for currency codes — keep in sync with the Currency
// type union and reuse via z.enum(CURRENCY_VALUES) in validation schemas.
export const CURRENCY_VALUES = ['EUR', 'USD', 'BRL', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK'] as const;

export const CURRENCIES: { value: Currency; label: string; symbol: string }[] = [
  { value: 'EUR', label: 'Euro', symbol: '€' },
  { value: 'USD', label: 'US Dollar', symbol: '$' },
  { value: 'BRL', label: 'Brazilian Real', symbol: 'R$' },
  { value: 'GBP', label: 'British Pound', symbol: '£' },
  { value: 'JPY', label: 'Japanese Yen', symbol: '¥' },
  { value: 'CHF', label: 'Swiss Franc', symbol: 'CHF' },
  { value: 'CAD', label: 'Canadian Dollar', symbol: 'C$' },
  { value: 'AUD', label: 'Australian Dollar', symbol: 'A$' },
  { value: 'SEK', label: 'Swedish Krona', symbol: 'kr' },
  { value: 'NOK', label: 'Norwegian Krone', symbol: 'kr' },
  { value: 'DKK', label: 'Danish Krone', symbol: 'kr' },
];

export const PLANNING_HORIZONS = [
  { value: 12, label: '1 Year' },
  { value: 24, label: '2 Years' },
  { value: 36, label: '3 Years' },
  { value: 60, label: '5 Years' },
  { value: 120, label: '10 Years' },
  { value: -1, label: 'Custom End Date' },
];

export const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly (every 3 months)' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom Interval' },
];

export const ITEM_CATEGORIES = [
  'Salary',
  'Freelance',
  'Investment',
  'Rental Income',
  'Other Income',
  'Housing',
  'Utilities',
  'Transportation',
  'Food & Groceries',
  'Healthcare',
  'Insurance',
  'Entertainment',
  'Shopping',
  'Travel',
  'Education',
  'Taxes',
  'Debt Payment',
  'Savings',
  'Reimbursement',
  'Other Expense',
];

// Short, plain-word categories for trip/project budgets (lines, grant
// restrictions and the expense log all pick from this same list).
export const BUDGET_CATEGORIES = [
  'Accommodation',
  'Travel',
  'Local transport',
  'Food',
  'Insurance',
  'Fees',
  'Equipment',
  'Other',
];

export const APP_NAME = 'Sampolio';
export const APP_DESCRIPTION = 'Personal Finance Planning Tool';

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export function getCurrencySymbol(currency: Currency): string {
  return CURRENCIES.find(c => c.value === currency)?.symbol || currency;
}

export const LOCALE = 'fi-FI';

export function formatCurrency(amount: number, currency: Currency): string {
  const symbol = getCurrencySymbol(currency);
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  
  if (amount < 0) {
    return `−${symbol}${formatted}`;
  }
  return `${symbol}${formatted}`;
}

export function formatYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${MONTHS[parseInt(month, 10) - 1]} ${year}`;
}

export function formatYearMonthShort(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${MONTHS_SHORT[parseInt(month, 10) - 1]} ${year}`;
}

/** Format a percentage rate with two decimals, fi-FI style (e.g. "2,71 %"). */
export function formatRate(rate: number): string {
  return `${new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rate)} %`;
}

// Mortgage option lists
export const MORTGAGE_PAYMENT_MODES = [
  { value: 'annuity-fixed-term', label: 'Fixed term (payment recalculated each year)' },
  { value: 'fixed-payment', label: 'Fixed payment (term flexes)' },
];

export const MORTGAGE_DAY_COUNTS = [
  { value: 'actual/360', label: 'Actual / 360 (Finnish default)' },
  { value: '30E/360', label: '30 / 360' },
];
