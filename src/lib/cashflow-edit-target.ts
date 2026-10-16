import type { SalaryConfig, TaxedIncome } from '@/types';

/** Entity types the cashflow "Entire Series" action can open via EntityModalRouter. */
export type SeriesEditEntityType = 'income' | 'expense' | 'salary' | 'taxed-income';

export interface SeriesEditTarget {
    entityType: SeriesEditEntityType;
    entityId: string;
}

/**
 * Which entity the "Entire Series" edit of a projected line should open.
 *
 * A salary appears in the projection as its linked recurring item (the DB layer
 * writes a `Salary: {name}` recurring item per linked config), but that item is
 * hidden from the cashflow modal's list — the salary config owns it. Its series
 * is therefore edited as the salary config, never as a plain income. Taxed
 * incomes project under their own id (they have no recurring link), so they are
 * resolved by id for completeness. Everything else is a plain recurring item.
 */
export function resolveSeriesEditTarget(
    itemId: string,
    itemType: string | undefined,
    salaryConfigs: readonly Pick<SalaryConfig, 'id' | 'isLinkedToRecurring' | 'linkedRecurringItemId'>[],
    taxedIncomes: readonly Pick<TaxedIncome, 'id'>[] = [],
): SeriesEditTarget {
    const salary = salaryConfigs.find(
        (s) => s.isLinkedToRecurring && s.linkedRecurringItemId === itemId,
    );
    if (salary) return { entityType: 'salary', entityId: salary.id };

    if (taxedIncomes.some((t) => t.id === itemId)) {
        return { entityType: 'taxed-income', entityId: itemId };
    }

    return { entityType: itemType === 'income' ? 'income' : 'expense', entityId: itemId };
}
