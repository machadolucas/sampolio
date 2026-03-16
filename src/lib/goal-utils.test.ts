import { describe, it, expect } from 'vitest';
import { calculateGoalProgress } from './goal-utils';
import type { Goal, MonthlyProjection, WealthProjectionMonth } from '@/types';

const now = new Date().toISOString();

function createGoal(overrides?: Partial<Goal>): Goal {
  return {
    id: 'goal-1',
    userId: 'test-user',
    name: 'Test Goal',
    targetAmount: 10000,
    currency: 'EUR',
    trackingMethod: 'manual',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMonthlyProjection(overrides?: Partial<MonthlyProjection>): MonthlyProjection {
  return {
    yearMonth: '2026-01',
    year: 2026,
    month: 1,
    startingBalance: 5000,
    totalIncome: 3000,
    totalExpenses: 2000,
    netChange: 1000,
    endingBalance: 6000,
    incomeBreakdown: [],
    expenseBreakdown: [],
    ...overrides,
  };
}

function createWealthMonth(overrides?: Partial<WealthProjectionMonth>): WealthProjectionMonth {
  return {
    yearMonth: '2026-01',
    year: 2026,
    month: 1,
    cashAccountsTotal: 5000,
    cashAccountsBreakdown: [],
    investmentsTotal: 10000,
    investmentsBreakdown: [],
    receivablesTotal: 0,
    receivablesBreakdown: [],
    debtsTotal: 0,
    debtsBreakdown: [],
    netWorth: 15000,
    ...overrides,
  };
}

describe('calculateGoalProgress', () => {
  describe('manual tracking', () => {
    it('uses currentManualAmount and calculates correct percentage', () => {
      const goal = createGoal({
        trackingMethod: 'manual',
        targetAmount: 10000,
        currentManualAmount: 2500,
      });

      const result = calculateGoalProgress(goal);

      expect(result.currentAmount).toBe(2500);
      expect(result.targetAmount).toBe(10000);
      expect(result.percentComplete).toBe(25);
      expect(result.projectedAmountAtTarget).toBeNull();
      expect(result.onTrack).toBe(false);
      expect(result.projectedDate).toBeNull();
    });

    it('treats missing currentManualAmount as 0', () => {
      const goal = createGoal({
        trackingMethod: 'manual',
        targetAmount: 5000,
      });

      const result = calculateGoalProgress(goal);

      expect(result.currentAmount).toBe(0);
      expect(result.percentComplete).toBe(0);
    });

    it('caps percentComplete at 100', () => {
      const goal = createGoal({
        trackingMethod: 'manual',
        targetAmount: 1000,
        currentManualAmount: 1500,
      });

      const result = calculateGoalProgress(goal);

      expect(result.percentComplete).toBe(100);
      expect(result.onTrack).toBe(true);
    });
  });

  describe('account-balance tracking', () => {
    it('finds correct projected amount at target date', () => {
      const goal = createGoal({
        trackingMethod: 'account-balance',
        linkedAccountId: 'acct-1',
        targetAmount: 8000,
        targetDate: '2026-03',
      });

      const projections = new Map<string, MonthlyProjection[]>();
      projections.set('acct-1', [
        createMonthlyProjection({ yearMonth: '2026-01', startingBalance: 5000, endingBalance: 6000 }),
        createMonthlyProjection({ yearMonth: '2026-02', startingBalance: 6000, endingBalance: 7000 }),
        createMonthlyProjection({ yearMonth: '2026-03', startingBalance: 7000, endingBalance: 8000 }),
        createMonthlyProjection({ yearMonth: '2026-04', startingBalance: 8000, endingBalance: 9000 }),
      ]);

      const result = calculateGoalProgress(goal, projections);

      expect(result.currentAmount).toBe(5000);
      expect(result.projectedAmountAtTarget).toBe(8000);
      expect(result.onTrack).toBe(true);
      expect(result.projectedDate).toBe('2026-03');
    });

    it('returns null projectedAmountAtTarget when target date is not in projections', () => {
      const goal = createGoal({
        trackingMethod: 'account-balance',
        linkedAccountId: 'acct-1',
        targetAmount: 50000,
        targetDate: '2030-12',
      });

      const projections = new Map<string, MonthlyProjection[]>();
      projections.set('acct-1', [
        createMonthlyProjection({ yearMonth: '2026-01', startingBalance: 5000, endingBalance: 6000 }),
      ]);

      const result = calculateGoalProgress(goal, projections);

      expect(result.currentAmount).toBe(5000);
      expect(result.projectedAmountAtTarget).toBeNull();
      expect(result.onTrack).toBe(false);
    });

    it('handles no projections gracefully', () => {
      const goal = createGoal({
        trackingMethod: 'account-balance',
        linkedAccountId: 'acct-1',
        targetAmount: 10000,
      });

      const result = calculateGoalProgress(goal);

      expect(result.currentAmount).toBe(0);
      expect(result.projectedAmountAtTarget).toBeNull();
      expect(result.projectedDate).toBeNull();
    });
  });

  describe('net-worth tracking', () => {
    it('finds correct net worth at target date', () => {
      const goal = createGoal({
        trackingMethod: 'net-worth',
        targetAmount: 20000,
        targetDate: '2026-02',
      });

      const wealthProjections: WealthProjectionMonth[] = [
        createWealthMonth({ yearMonth: '2026-01', netWorth: 15000 }),
        createWealthMonth({ yearMonth: '2026-02', netWorth: 20000 }),
        createWealthMonth({ yearMonth: '2026-03', netWorth: 25000 }),
      ];

      const result = calculateGoalProgress(goal, undefined, wealthProjections);

      expect(result.currentAmount).toBe(15000);
      expect(result.projectedAmountAtTarget).toBe(20000);
      expect(result.onTrack).toBe(true);
      expect(result.projectedDate).toBe('2026-02');
    });

    it('handles no wealth projections gracefully', () => {
      const goal = createGoal({
        trackingMethod: 'net-worth',
        targetAmount: 100000,
      });

      const result = calculateGoalProgress(goal, undefined, undefined);

      expect(result.currentAmount).toBe(0);
      expect(result.projectedAmountAtTarget).toBeNull();
      expect(result.projectedDate).toBeNull();
    });
  });

  describe('100% complete goal', () => {
    it('reports 100% and onTrack for a fully achieved manual goal', () => {
      const goal = createGoal({
        trackingMethod: 'manual',
        targetAmount: 5000,
        currentManualAmount: 5000,
      });

      const result = calculateGoalProgress(goal);

      expect(result.percentComplete).toBe(100);
      expect(result.onTrack).toBe(true);
    });
  });

  describe('on track vs not on track', () => {
    it('reports not on track when projected amount is below target', () => {
      const goal = createGoal({
        trackingMethod: 'account-balance',
        linkedAccountId: 'acct-1',
        targetAmount: 20000,
        targetDate: '2026-03',
      });

      const projections = new Map<string, MonthlyProjection[]>();
      projections.set('acct-1', [
        createMonthlyProjection({ yearMonth: '2026-01', startingBalance: 5000, endingBalance: 6000 }),
        createMonthlyProjection({ yearMonth: '2026-02', startingBalance: 6000, endingBalance: 7000 }),
        createMonthlyProjection({ yearMonth: '2026-03', startingBalance: 7000, endingBalance: 8000 }),
      ]);

      const result = calculateGoalProgress(goal, projections);

      expect(result.onTrack).toBe(false);
      expect(result.projectedAmountAtTarget).toBe(8000);
      expect(result.projectedDate).toBeNull(); // never reaches 20000
    });

    it('reports on track when projected amount exceeds target', () => {
      const goal = createGoal({
        trackingMethod: 'account-balance',
        linkedAccountId: 'acct-1',
        targetAmount: 7000,
        targetDate: '2026-03',
      });

      const projections = new Map<string, MonthlyProjection[]>();
      projections.set('acct-1', [
        createMonthlyProjection({ yearMonth: '2026-01', startingBalance: 5000, endingBalance: 6000 }),
        createMonthlyProjection({ yearMonth: '2026-02', startingBalance: 6000, endingBalance: 7000 }),
        createMonthlyProjection({ yearMonth: '2026-03', startingBalance: 7000, endingBalance: 8000 }),
      ]);

      const result = calculateGoalProgress(goal, projections);

      expect(result.onTrack).toBe(true);
      expect(result.projectedAmountAtTarget).toBe(8000);
      expect(result.projectedDate).toBe('2026-02'); // first month reaching 7000
    });
  });
});
