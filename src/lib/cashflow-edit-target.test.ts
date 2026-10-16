import { describe, it, expect } from 'vitest';
import { resolveSeriesEditTarget } from './cashflow-edit-target';

const salary = { id: 'sal-1', isLinkedToRecurring: true, linkedRecurringItemId: 'rec-salary' };

describe('resolveSeriesEditTarget', () => {
    it('maps a salary-linked recurring item to its salary config', () => {
        expect(resolveSeriesEditTarget('rec-salary', 'income', [salary])).toEqual({
            entityType: 'salary',
            entityId: 'sal-1',
        });
    });

    it('ignores a salary config that is not linked to a recurring item', () => {
        const unlinked = { id: 'sal-2', isLinkedToRecurring: false, linkedRecurringItemId: 'rec-x' };
        expect(resolveSeriesEditTarget('rec-x', 'income', [unlinked])).toEqual({
            entityType: 'income',
            entityId: 'rec-x',
        });
    });

    it('keeps plain recurring incomes and expenses as-is', () => {
        expect(resolveSeriesEditTarget('rec-1', 'income', [salary])).toEqual({ entityType: 'income', entityId: 'rec-1' });
        expect(resolveSeriesEditTarget('rec-2', 'expense', [salary])).toEqual({ entityType: 'expense', entityId: 'rec-2' });
    });

    it('defaults an unknown/missing type to expense', () => {
        expect(resolveSeriesEditTarget('rec-3', undefined, [])).toEqual({ entityType: 'expense', entityId: 'rec-3' });
        expect(resolveSeriesEditTarget('rec-3', '', [])).toEqual({ entityType: 'expense', entityId: 'rec-3' });
    });

    it('resolves a taxed income by its own id', () => {
        expect(resolveSeriesEditTarget('ti-1', 'income', [salary], [{ id: 'ti-1' }])).toEqual({
            entityType: 'taxed-income',
            entityId: 'ti-1',
        });
    });

    it('prefers the salary link over a taxed income when ids never collide in practice', () => {
        expect(resolveSeriesEditTarget('rec-salary', 'income', [salary], [{ id: 'ti-1' }]).entityType).toBe('salary');
    });
});
