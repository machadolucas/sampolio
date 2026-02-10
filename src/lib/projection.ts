import type {
  YearMonth,
  FinancialAccount,
  RecurringItem,
  PlannedItem,
  MonthlyProjection,
  YearlyRollup,
  ProjectionLineItem,
  ProjectionFilters,
  Frequency
} from '@/types';

// Year-Month utility functions
export function parseYearMonth(yearMonth: YearMonth): { year: number; month: number } {
  const [yearStr, monthStr] = yearMonth.split('-');
  return { year: parseInt(yearStr, 10), month: parseInt(monthStr, 10) };
}

export function formatYearMonth(year: number, month: number): YearMonth {
  return `${year}-${month.toString().padStart(2, '0')}`;
}

export function addMonths(yearMonth: YearMonth, months: number): YearMonth {
  const { year, month } = parseYearMonth(yearMonth);
  const totalMonths = year * 12 + (month - 1) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  return formatYearMonth(newYear, newMonth);
}

export function compareYearMonths(a: YearMonth, b: YearMonth): number {
  return a.localeCompare(b);
}

export function isYearMonthInRange(
  yearMonth: YearMonth,
  startDate: YearMonth,
  endDate?: YearMonth
): boolean {
  if (compareYearMonths(yearMonth, startDate) < 0) {
    return false;
  }
  if (endDate && compareYearMonths(yearMonth, endDate) > 0) {
    return false;
  }
  return true;
}

export function getMonthsBetween(start: YearMonth, end: YearMonth): number {
  const startParsed = parseYearMonth(start);
  const endParsed = parseYearMonth(end);
  return (endParsed.year - startParsed.year) * 12 + (endParsed.month - startParsed.month);
}

// Get the interval in months for a given frequency
export function getIntervalMonths(frequency: Frequency, customIntervalMonths?: number): number {
  switch (frequency) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'yearly':
      return 12;
    case 'custom':
      return customIntervalMonths || 1;
    default:
      return 1;
  }
}

// Check if a recurring item is active in a specific month
export function isRecurringItemActiveInMonth(
  item: RecurringItem,
  yearMonth: YearMonth
): boolean {
  if (!item.isActive) {
    return false;
  }

  if (!isYearMonthInRange(yearMonth, item.startDate, item.endDate)) {
    return false;
  }

  // For non-monthly frequencies, check if this is an occurrence month
  const intervalMonths = getIntervalMonths(item.frequency, item.customIntervalMonths);
  if (intervalMonths > 1) {
    const monthsSinceStart = getMonthsBetween(item.startDate, yearMonth);
    if (monthsSinceStart % intervalMonths !== 0) {
      return false;
    }
  }

  return true;
}

// Get all occurrences of a planned repeating item within a date range
export function getPlannedRepeatingOccurrences(
  item: PlannedItem,
  startDate: YearMonth,
  endDate: YearMonth
): YearMonth[] {
  if (item.kind !== 'repeating' || !item.firstOccurrence || !item.frequency) {
    return [];
  }

  const occurrences: YearMonth[] = [];
  const intervalMonths = getIntervalMonths(item.frequency, item.customIntervalMonths);
  let currentDate = item.firstOccurrence;

  // Move to first occurrence that's >= startDate
  while (compareYearMonths(currentDate, startDate) < 0) {
    currentDate = addMonths(currentDate, intervalMonths);
  }

  // Collect all occurrences until endDate or item's endDate
  while (compareYearMonths(currentDate, endDate) <= 0) {
    if (item.endDate && compareYearMonths(currentDate, item.endDate) > 0) {
      break;
    }
    occurrences.push(currentDate);
    currentDate = addMonths(currentDate, intervalMonths);
  }

  return occurrences;
}

// Generate the list of months for projection
export function generateMonthList(
  account: FinancialAccount
): YearMonth[] {
  const months: YearMonth[] = [];
  let endDate: YearMonth;

  if (account.customEndDate) {
    endDate = account.customEndDate;
  } else {
    endDate = addMonths(account.startingDate, account.planningHorizonMonths - 1);
  }

  let currentDate = account.startingDate;
  while (compareYearMonths(currentDate, endDate) <= 0) {
    months.push(currentDate);
    currentDate = addMonths(currentDate, 1);
  }

  return months;
}

// Calculate projection for a single account
export function calculateProjection(
  account: FinancialAccount,
  recurringItems: RecurringItem[],
  plannedItems: PlannedItem[],
  filters?: ProjectionFilters
): MonthlyProjection[] {
  const months = generateMonthList(account);
  const projections: MonthlyProjection[] = [];

  let runningBalance = account.startingBalance;

  // Separate recurring-override PlannedItems from regular ones
  const overrideMap = new Map<string, Map<YearMonth, PlannedItem>>();
  const regularPlannedItems = plannedItems.filter(p => {
    if (p.isRecurringOverride && p.linkedRecurringItemId && p.scheduledDate) {
      let itemOverrides = overrideMap.get(p.linkedRecurringItemId);
      if (!itemOverrides) {
        itemOverrides = new Map();
        overrideMap.set(p.linkedRecurringItemId, itemOverrides);
      }
      itemOverrides.set(p.scheduledDate, p);
      return false; // exclude from regular planned-item processing
    }
    return true;
  });

  // Build a map of one-off items by month
  const oneOffByMonth = new Map<YearMonth, PlannedItem[]>();
  for (const item of regularPlannedItems.filter(p => p.kind === 'one-off' && p.scheduledDate)) {
    const month = item.scheduledDate!;
    if (!oneOffByMonth.has(month)) {
      oneOffByMonth.set(month, []);
    }
    oneOffByMonth.get(month)!.push(item);
  }

  // Build a map of repeating items occurrences
  const repeatingItems = regularPlannedItems.filter(p => p.kind === 'repeating');
  const repeatingOccurrences = new Map<YearMonth, PlannedItem[]>();

  if (months.length > 0) {
    const projectionStart = months[0];
    const projectionEnd = months[months.length - 1];

    for (const item of repeatingItems) {
      const occurrences = getPlannedRepeatingOccurrences(item, projectionStart, projectionEnd);
      for (const occurrence of occurrences) {
        if (!repeatingOccurrences.has(occurrence)) {
          repeatingOccurrences.set(occurrence, []);
        }
        repeatingOccurrences.get(occurrence)!.push(item);
      }
    }
  }

  for (const yearMonth of months) {
    // Apply filters
    if (filters?.startDate && compareYearMonths(yearMonth, filters.startDate) < 0) {
      continue;
    }
    if (filters?.endDate && compareYearMonths(yearMonth, filters.endDate) > 0) {
      break;
    }

    const { year, month } = parseYearMonth(yearMonth);
    const incomeBreakdown: ProjectionLineItem[] = [];
    const expenseBreakdown: ProjectionLineItem[] = [];

    // Process recurring items
    for (const item of recurringItems) {
      if (!isRecurringItemActiveInMonth(item, yearMonth)) {
        continue;
      }

      // Check for an occurrence override
      const override = overrideMap.get(item.id)?.get(yearMonth);
      if (override?.skipOccurrence) {
        continue; // skip this occurrence entirely
      }

      // Apply category filter
      const effectiveCategory = override?.category ?? item.category;
      if (filters?.categories?.length && effectiveCategory && !filters.categories.includes(effectiveCategory)) {
        continue;
      }

      // Apply item type filter (override cannot change type)
      if (filters?.itemTypes?.length && !filters.itemTypes.includes(item.type)) {
        continue;
      }

      // Apply item kind filter
      if (filters?.itemKinds?.length && !filters.itemKinds.includes('recurring')) {
        continue;
      }

      const lineItem: ProjectionLineItem = {
        itemId: item.id,
        name: override?.name ?? item.name,
        amount: override?.amount ?? item.amount,
        category: effectiveCategory,
        source: 'recurring',
        isOverridden: !!override,
      };

      if (item.type === 'income') {
        incomeBreakdown.push(lineItem);
      } else {
        expenseBreakdown.push(lineItem);
      }
    }

    // Process one-off planned items for this month
    const oneOffsThisMonth = oneOffByMonth.get(yearMonth) || [];
    for (const item of oneOffsThisMonth) {
      // Apply category filter
      if (filters?.categories?.length && item.category && !filters.categories.includes(item.category)) {
        continue;
      }

      // Apply item type filter
      if (filters?.itemTypes?.length && !filters.itemTypes.includes(item.type)) {
        continue;
      }

      // Apply item kind filter
      if (filters?.itemKinds?.length && !filters.itemKinds.includes('one-off')) {
        continue;
      }

      const lineItem: ProjectionLineItem = {
        itemId: item.id,
        name: item.name,
        amount: item.amount,
        category: item.category,
        source: 'planned-one-off',
      };

      if (item.type === 'income') {
        incomeBreakdown.push(lineItem);
      } else {
        expenseBreakdown.push(lineItem);
      }
    }

    // Process repeating planned items for this month
    const repeatingThisMonth = repeatingOccurrences.get(yearMonth) || [];
    for (const item of repeatingThisMonth) {
      // Apply category filter
      if (filters?.categories?.length && item.category && !filters.categories.includes(item.category)) {
        continue;
      }

      // Apply item type filter
      if (filters?.itemTypes?.length && !filters.itemTypes.includes(item.type)) {
        continue;
      }

      // Apply item kind filter
      if (filters?.itemKinds?.length && !filters.itemKinds.includes('repeating')) {
        continue;
      }

      const lineItem: ProjectionLineItem = {
        itemId: item.id,
        name: item.name,
        amount: item.amount,
        category: item.category,
        source: 'planned-repeating',
      };

      if (item.type === 'income') {
        incomeBreakdown.push(lineItem);
      } else {
        expenseBreakdown.push(lineItem);
      }
    }

    // Calculate totals
    const totalIncome = incomeBreakdown.reduce((sum, item) => sum + item.amount, 0);
    const totalExpenses = expenseBreakdown.reduce((sum, item) => sum + item.amount, 0);
    const netChange = totalIncome - totalExpenses;
    const startingBalance = runningBalance;
    const endingBalance = startingBalance + netChange;

    projections.push({
      yearMonth,
      year,
      month,
      startingBalance,
      totalIncome,
      totalExpenses,
      netChange,
      endingBalance,
      incomeBreakdown,
      expenseBreakdown,
    });

    // Update running balance for next month
    runningBalance = endingBalance;
  }

  return projections;
}

// Group monthly projections into yearly rollups
export function calculateYearlyRollups(
  monthlyProjections: MonthlyProjection[]
): YearlyRollup[] {
  const yearlyMap = new Map<number, MonthlyProjection[]>();

  for (const projection of monthlyProjections) {
    if (!yearlyMap.has(projection.year)) {
      yearlyMap.set(projection.year, []);
    }
    yearlyMap.get(projection.year)!.push(projection);
  }

  const rollups: YearlyRollup[] = [];

  for (const [year, months] of yearlyMap) {
    const sortedMonths = months.sort((a, b) => a.month - b.month);
    const totalIncome = sortedMonths.reduce((sum, m) => sum + m.totalIncome, 0);
    const totalExpenses = sortedMonths.reduce((sum, m) => sum + m.totalExpenses, 0);
    const netChange = totalIncome - totalExpenses;
    const startingBalance = sortedMonths[0].startingBalance;
    const endingBalance = sortedMonths[sortedMonths.length - 1].endingBalance;

    rollups.push({
      year,
      totalIncome,
      totalExpenses,
      netChange,
      startingBalance,
      endingBalance,
      months: sortedMonths,
    });
  }

  return rollups.sort((a, b) => a.year - b.year);
}

// Get current year-month
export function getCurrentYearMonth(): YearMonth {
  const now = new Date();
  return formatYearMonth(now.getFullYear(), now.getMonth() + 1);
}

// Get unique categories from items
export function getUniqueCategories(
  recurringItems: RecurringItem[],
  plannedItems: PlannedItem[]
): string[] {
  const categories = new Set<string>();

  for (const item of recurringItems) {
    if (item.category) {
      categories.add(item.category);
    }
  }

  for (const item of plannedItems) {
    if (item.category) {
      categories.add(item.category);
    }
  }

  return Array.from(categories).sort();
}
