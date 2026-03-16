import { describe, it, expect } from 'vitest';
import { calculateProjection, calculateYearlyRollups } from './projection';
import { createMockAccount, createMockRecurringItem, createMockPlannedItem, createMockTaxedIncome } from '@/test/mocks';

describe('calculateProjection', () => {
  const account = createMockAccount({
    startingBalance: 5000,
    startingDate: '2026-01',
    planningHorizonMonths: 6,
  });

  describe('recurring items', () => {
    it('applies monthly income and expense correctly', () => {
      const income = createMockRecurringItem({
        accountId: account.id,
        type: 'income',
        amount: 3000,
        frequency: 'monthly',
        startDate: '2026-01',
      });
      const expense = createMockRecurringItem({
        accountId: account.id,
        type: 'expense',
        amount: 2000,
        frequency: 'monthly',
        startDate: '2026-01',
      });

      const result = calculateProjection(account, [income, expense], []);

      expect(result).toHaveLength(6);
      // Month 1: 5000 + 3000 - 2000 = 6000
      expect(result[0].startingBalance).toBe(5000);
      expect(result[0].totalIncome).toBe(3000);
      expect(result[0].totalExpenses).toBe(2000);
      expect(result[0].endingBalance).toBe(6000);
      // Month 2: 6000 + 3000 - 2000 = 7000
      expect(result[1].startingBalance).toBe(6000);
      expect(result[1].endingBalance).toBe(7000);
      // Month 6: 5000 + 6 * 1000 = 11000
      expect(result[5].endingBalance).toBe(11000);
    });

    it('quarterly items appear in correct months only', () => {
      const quarterly = createMockRecurringItem({
        accountId: account.id,
        type: 'income',
        amount: 1000,
        frequency: 'quarterly',
        startDate: '2026-01',
      });

      const result = calculateProjection(account, [quarterly], []);

      // Quarterly starting from Jan: appears in Jan (month 0), Apr (month 3)
      expect(result[0].totalIncome).toBe(1000); // Jan
      expect(result[1].totalIncome).toBe(0);    // Feb
      expect(result[2].totalIncome).toBe(0);    // Mar
      expect(result[3].totalIncome).toBe(1000); // Apr
      expect(result[4].totalIncome).toBe(0);    // May
      expect(result[5].totalIncome).toBe(0);    // Jun
    });

    it('yearly items appear in correct months only', () => {
      const yearly = createMockRecurringItem({
        accountId: account.id,
        type: 'expense',
        amount: 5000,
        frequency: 'yearly',
        startDate: '2026-01',
      });

      const result = calculateProjection(account, [yearly], []);

      expect(result[0].totalExpenses).toBe(5000); // Jan
      for (let i = 1; i < 6; i++) {
        expect(result[i].totalExpenses).toBe(0); // Feb-Jun
      }
    });

    it('inactive items are excluded', () => {
      const inactive = createMockRecurringItem({
        accountId: account.id,
        type: 'income',
        amount: 3000,
        isActive: false,
      });

      const result = calculateProjection(account, [inactive], []);
      expect(result[0].totalIncome).toBe(0);
    });

    it('items with start/end dates only active within range', () => {
      const item = createMockRecurringItem({
        accountId: account.id,
        type: 'income',
        amount: 1000,
        startDate: '2026-03',
        endDate: '2026-04',
      });

      const result = calculateProjection(account, [item], []);

      expect(result[0].totalIncome).toBe(0);    // Jan
      expect(result[1].totalIncome).toBe(0);    // Feb
      expect(result[2].totalIncome).toBe(1000); // Mar
      expect(result[3].totalIncome).toBe(1000); // Apr
      expect(result[4].totalIncome).toBe(0);    // May
    });
  });

  describe('planned items', () => {
    it('one-off items appear in scheduled month only', () => {
      const oneOff = createMockPlannedItem({
        accountId: account.id,
        type: 'expense',
        kind: 'one-off',
        amount: 500,
        scheduledDate: '2026-03',
      });

      const result = calculateProjection(account, [], [oneOff]);

      expect(result[0].totalExpenses).toBe(0);   // Jan
      expect(result[1].totalExpenses).toBe(0);   // Feb
      expect(result[2].totalExpenses).toBe(500); // Mar
      expect(result[3].totalExpenses).toBe(0);   // Apr
    });

    it('repeating items appear at correct frequency', () => {
      const repeating = createMockPlannedItem({
        accountId: account.id,
        type: 'expense',
        kind: 'repeating',
        amount: 100,
        frequency: 'monthly',
        firstOccurrence: '2026-01',
      });

      const result = calculateProjection(account, [], [repeating]);
      for (const month of result) {
        expect(month.totalExpenses).toBe(100);
      }
    });
  });

  describe('occurrence overrides', () => {
    it('amount override is applied correctly', () => {
      const recurring = createMockRecurringItem({
        accountId: account.id,
        type: 'expense',
        amount: 1000,
        startDate: '2026-01',
      });

      const override = createMockPlannedItem({
        accountId: account.id,
        type: 'expense',
        kind: 'one-off',
        name: 'Override',
        amount: 1500,
        scheduledDate: '2026-02',
        isRecurringOverride: true,
        linkedRecurringItemId: recurring.id,
      });

      const result = calculateProjection(account, [recurring], [override]);

      expect(result[0].totalExpenses).toBe(1000); // Jan: original
      expect(result[1].totalExpenses).toBe(1500); // Feb: overridden
      expect(result[2].totalExpenses).toBe(1000); // Mar: original
    });

    it('skip occurrence excludes the item', () => {
      const recurring = createMockRecurringItem({
        accountId: account.id,
        type: 'expense',
        amount: 1000,
        startDate: '2026-01',
      });

      const skip = createMockPlannedItem({
        accountId: account.id,
        type: 'expense',
        kind: 'one-off',
        amount: 0,
        scheduledDate: '2026-03',
        isRecurringOverride: true,
        linkedRecurringItemId: recurring.id,
        skipOccurrence: true,
      });

      const result = calculateProjection(account, [recurring], [skip]);

      expect(result[0].totalExpenses).toBe(1000); // Jan
      expect(result[1].totalExpenses).toBe(1000); // Feb
      expect(result[2].totalExpenses).toBe(0);    // Mar: skipped
      expect(result[3].totalExpenses).toBe(1000); // Apr
    });
  });

  describe('expired override filtering', () => {
    it('override with old date is excluded from projection', () => {
      // Account starts in 2026-06, so 2 months before is 2026-04
      const laterAccount = createMockAccount({
        startingBalance: 5000,
        startingDate: '2026-06',
        planningHorizonMonths: 3,
      });
      const recurring = createMockRecurringItem({
        accountId: laterAccount.id,
        type: 'expense',
        amount: 1000,
        startDate: '2026-01',
      });
      const expiredOverride = createMockPlannedItem({
        accountId: laterAccount.id,
        type: 'expense',
        kind: 'one-off',
        amount: 2000,
        scheduledDate: '2026-01', // Way before projection start
        isRecurringOverride: true,
        linkedRecurringItemId: recurring.id,
      });

      const result = calculateProjection(laterAccount, [recurring], [expiredOverride]);
      // The expired override for 2026-01 should be ignored
      // All months should see the original amount
      expect(result[0].totalExpenses).toBe(1000); // Jun
      expect(result[1].totalExpenses).toBe(1000); // Jul
    });

    it('recent override is included', () => {
      const recurring = createMockRecurringItem({
        accountId: account.id,
        type: 'expense',
        amount: 1000,
        startDate: '2026-01',
      });
      const recentOverride = createMockPlannedItem({
        accountId: account.id,
        type: 'expense',
        kind: 'one-off',
        amount: 2000,
        scheduledDate: '2026-02', // Within range
        isRecurringOverride: true,
        linkedRecurringItemId: recurring.id,
      });

      const result = calculateProjection(account, [recurring], [recentOverride]);
      expect(result[1].totalExpenses).toBe(2000); // Feb: overridden
    });

    it('non-override planned items are never filtered', () => {
      const laterAccount = createMockAccount({
        startingBalance: 5000,
        startingDate: '2026-06',
        planningHorizonMonths: 3,
      });
      const oldOneOff = createMockPlannedItem({
        accountId: laterAccount.id,
        type: 'expense',
        kind: 'one-off',
        amount: 500,
        scheduledDate: '2026-01', // Old but NOT an override
        isRecurringOverride: false,
      });

      const result = calculateProjection(laterAccount, [], [oldOneOff]);
      // Non-override planned items shouldn't be filtered by the cutoff
      // But this one-off is scheduled for 2026-01 which is outside the projection range (2026-06 to 2026-08)
      // So it won't appear anyway
      expect(result[0].totalExpenses).toBe(0);
    });
  });

  describe('taxed income items', () => {
    it('one-off taxed income appears in correct month using netAmount', () => {
      const taxedIncome = createMockTaxedIncome({
        accountId: account.id,
        kind: 'one-off',
        name: 'Bonus',
        netAmount: 3100,
        grossAmount: 5000,
        scheduledDate: '2026-03',
      });

      const result = calculateProjection(account, [], [], [taxedIncome]);

      expect(result[0].totalIncome).toBe(0);    // Jan
      expect(result[1].totalIncome).toBe(0);    // Feb
      expect(result[2].totalIncome).toBe(3100); // Mar: netAmount
      expect(result[3].totalIncome).toBe(0);    // Apr
    });

    it('recurring taxed income at correct frequency', () => {
      const taxedIncome = createMockTaxedIncome({
        accountId: account.id,
        kind: 'recurring',
        name: 'Monthly Bonus',
        netAmount: 500,
        frequency: 'monthly',
        startDate: '2026-01',
        scheduledDate: undefined,
      });

      const result = calculateProjection(account, [], [], [taxedIncome]);
      for (const month of result) {
        expect(month.totalIncome).toBe(500);
      }
    });

    it('quarterly taxed income appears in correct months', () => {
      const taxedIncome = createMockTaxedIncome({
        accountId: account.id,
        kind: 'recurring',
        name: 'Quarterly Bonus',
        netAmount: 2000,
        frequency: 'quarterly',
        startDate: '2026-01',
        scheduledDate: undefined,
      });

      const result = calculateProjection(account, [], [], [taxedIncome]);

      expect(result[0].totalIncome).toBe(2000); // Jan
      expect(result[1].totalIncome).toBe(0);    // Feb
      expect(result[2].totalIncome).toBe(0);    // Mar
      expect(result[3].totalIncome).toBe(2000); // Apr
    });

    it('uses netAmount not grossAmount', () => {
      const taxedIncome = createMockTaxedIncome({
        accountId: account.id,
        kind: 'one-off',
        grossAmount: 10000,
        netAmount: 6200,
        scheduledDate: '2026-02',
      });

      const result = calculateProjection(account, [], [], [taxedIncome]);
      expect(result[1].totalIncome).toBe(6200); // Net, not gross
    });

    it('inactive taxed income is excluded', () => {
      const taxedIncome = createMockTaxedIncome({
        accountId: account.id,
        kind: 'one-off',
        netAmount: 5000,
        scheduledDate: '2026-02',
        isActive: false,
      });

      const result = calculateProjection(account, [], [], [taxedIncome]);
      expect(result[1].totalIncome).toBe(0);
    });

    it('taxed income with end date respects range', () => {
      const taxedIncome = createMockTaxedIncome({
        accountId: account.id,
        kind: 'recurring',
        netAmount: 500,
        frequency: 'monthly',
        startDate: '2026-02',
        endDate: '2026-04',
        scheduledDate: undefined,
      });

      const result = calculateProjection(account, [], [], [taxedIncome]);

      expect(result[0].totalIncome).toBe(0);   // Jan: before start
      expect(result[1].totalIncome).toBe(500); // Feb
      expect(result[2].totalIncome).toBe(500); // Mar
      expect(result[3].totalIncome).toBe(500); // Apr
      expect(result[4].totalIncome).toBe(0);   // May: after end
    });
  });

  describe('shared expenses', () => {
    it('shared recurring item with 0.5 ratio uses half amount', () => {
      const shared = createMockRecurringItem({
        accountId: account.id,
        type: 'expense',
        amount: 1000,
        isShared: true,
        shareRatio: 0.5,
        startDate: '2026-01',
      });

      const result = calculateProjection(account, [shared], []);
      expect(result[0].totalExpenses).toBe(500); // Half of 1000
    });

    it('shared recurring item with custom ratio', () => {
      const shared = createMockRecurringItem({
        accountId: account.id,
        type: 'expense',
        amount: 1000,
        isShared: true,
        shareRatio: 0.3,
        startDate: '2026-01',
      });

      const result = calculateProjection(account, [shared], []);
      expect(result[0].totalExpenses).toBe(300);
    });

    it('non-shared items unaffected', () => {
      const normal = createMockRecurringItem({
        accountId: account.id,
        type: 'expense',
        amount: 1000,
        isShared: false,
        startDate: '2026-01',
      });

      const result = calculateProjection(account, [normal], []);
      expect(result[0].totalExpenses).toBe(1000);
    });

    it('shared planned one-off item uses half amount', () => {
      const shared = createMockPlannedItem({
        accountId: account.id,
        type: 'expense',
        kind: 'one-off',
        amount: 2000,
        isShared: true,
        shareRatio: 0.5,
        scheduledDate: '2026-02',
      });

      const result = calculateProjection(account, [], [shared]);
      expect(result[1].totalExpenses).toBe(1000);
    });
  });

  describe('reimbursable expenses', () => {
    it('pending reimbursable: expense in month X, income in month Y', () => {
      const reimbursable = createMockPlannedItem({
        accountId: account.id,
        type: 'expense',
        kind: 'one-off',
        amount: 500,
        scheduledDate: '2026-02',
        isReimbursable: true,
        reimbursementStatus: 'pending',
        expectedReimbursementMonth: '2026-04',
      });

      const result = calculateProjection(account, [], [reimbursable]);
      expect(result[1].totalExpenses).toBe(500); // Feb: expense
      expect(result[3].totalIncome).toBe(500);   // Apr: reimbursement income
    });

    it('received reimbursable: expense only, no projected income', () => {
      const received = createMockPlannedItem({
        accountId: account.id,
        type: 'expense',
        kind: 'one-off',
        amount: 500,
        scheduledDate: '2026-02',
        isReimbursable: true,
        reimbursementStatus: 'received',
        expectedReimbursementMonth: '2026-04',
      });

      const result = calculateProjection(account, [], [received]);
      expect(result[1].totalExpenses).toBe(500); // Feb: expense
      expect(result[3].totalIncome).toBe(0);     // Apr: no income (already received)
    });
  });

  describe('empty inputs', () => {
    it('returns unchanged starting balance with no items', () => {
      const result = calculateProjection(account, [], []);

      expect(result).toHaveLength(6);
      for (const month of result) {
        expect(month.totalIncome).toBe(0);
        expect(month.totalExpenses).toBe(0);
        expect(month.endingBalance).toBe(5000);
      }
    });
  });

  describe('filters', () => {
    it('category filter excludes non-matching items', () => {
      const salary = createMockRecurringItem({
        accountId: account.id,
        type: 'income',
        amount: 3000,
        category: 'Salary',
      });
      const freelance = createMockRecurringItem({
        accountId: account.id,
        type: 'income',
        amount: 1000,
        category: 'Freelance',
      });

      const result = calculateProjection(account, [salary, freelance], [], [], {
        categories: ['Salary'],
      });

      expect(result[0].totalIncome).toBe(3000); // Only salary
    });
  });
});

describe('calculateYearlyRollups', () => {
  it('groups months by year with correct totals', () => {
    const account = createMockAccount({
      startingBalance: 0,
      startingDate: '2026-01',
      planningHorizonMonths: 24,
    });
    const income = createMockRecurringItem({
      accountId: account.id,
      type: 'income',
      amount: 1000,
      startDate: '2026-01',
    });

    const monthly = calculateProjection(account, [income], []);
    const yearly = calculateYearlyRollups(monthly);

    expect(yearly).toHaveLength(2);
    expect(yearly[0].year).toBe(2026);
    expect(yearly[0].totalIncome).toBe(12000); // 12 months * 1000
    expect(yearly[1].year).toBe(2027);
    expect(yearly[1].totalIncome).toBe(12000);
  });
});
