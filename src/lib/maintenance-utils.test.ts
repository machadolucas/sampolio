import { describe, it, expect } from 'vitest';
import { computeCompactionPlan, expiredOverrideCutoff } from './maintenance-utils';
import { resolveAnchor, calculateProjection } from './projection';
import { createMockAccount, createMockPlannedItem, createMockRecurringItem } from '@/test/mocks';
import type { BalanceSnapshot, PlannedItem, ReconciliationAdjustment, ReconciliationSession } from '@/types';

function snap(over: Partial<BalanceSnapshot> & { id: string; entityId: string; yearMonth: string }): BalanceSnapshot {
  return {
    userId: 'u', entityType: 'cash-account', expectedBalance: 0, actualBalance: 1000,
    variance: 0, createdAt: '2026-01-01T00:00:00Z', ...over,
  } as BalanceSnapshot;
}
function session(id: string, yearMonth: string): ReconciliationSession {
  return { id, userId: 'u', yearMonth, status: 'completed', startedAt: '', snapshots: [], adjustments: [] };
}
function adj(id: string, snapshotId: string): ReconciliationAdjustment {
  return { id, snapshotId, category: 'other', amount: 1, createdAt: '' };
}

describe('computeCompactionPlan', () => {
  it('keeps only the latest snapshot per entity', () => {
    const snapshots = [
      snap({ id: 's1', entityId: 'acc-A', yearMonth: '2026-01', actualBalance: 100 }),
      snap({ id: 's2', entityId: 'acc-A', yearMonth: '2026-03', actualBalance: 300 }),
      snap({ id: 's3', entityId: 'acc-A', yearMonth: '2026-06', actualBalance: 600 }),
      snap({ id: 's4', entityId: 'acc-B', yearMonth: '2026-02', actualBalance: 50 }),
    ];
    const plan = computeCompactionPlan(snapshots, [], []);
    // acc-A keeps s3 (2026-06), acc-B keeps s4 (only one).
    expect(new Set(plan.keptAnchorIds)).toEqual(new Set(['s3', 's4']));
    expect(new Set(plan.snapshotIds)).toEqual(new Set(['s1', 's2']));
  });

  it('prunes only adjustments orphaned by removed snapshots', () => {
    const snapshots = [
      snap({ id: 's1', entityId: 'acc-A', yearMonth: '2026-01' }),
      snap({ id: 's2', entityId: 'acc-A', yearMonth: '2026-06' }),
    ];
    const adjustments = [adj('a1', 's1'), adj('a2', 's2')];
    const plan = computeCompactionPlan(snapshots, adjustments, []);
    expect(plan.adjustmentIds).toEqual(['a1']); // a2 points at the kept anchor
  });

  it('prunes sessions strictly before the latest reconciliation month', () => {
    const snapshots = [snap({ id: 's2', entityId: 'acc-A', yearMonth: '2026-06' })];
    const sessions = [session('o1', '2026-01'), session('o2', '2026-05'), session('keep', '2026-06')];
    const plan = computeCompactionPlan(snapshots, [], sessions);
    expect(new Set(plan.sessionIds)).toEqual(new Set(['o1', 'o2']));
  });

  it('is a no-op when there is no history', () => {
    const plan = computeCompactionPlan([], [], []);
    expect(plan).toEqual({ snapshotIds: [], adjustmentIds: [], sessionIds: [], keptAnchorIds: [], overrides: [] });
  });

  it('INVARIANT: the projection anchor is identical before and after compaction', () => {
    // The projection only reads the latest snapshot (resolveAnchor). Pruning the
    // older ones must not change which snapshot the projection anchors on.
    const snapshots = [
      snap({ id: 's1', entityId: 'acc-A', yearMonth: '2026-01', actualBalance: 100 }),
      snap({ id: 's2', entityId: 'acc-A', yearMonth: '2026-06', actualBalance: 600 }),
    ];
    const latestBefore = [...snapshots].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth)).at(-1)!;

    const plan = computeCompactionPlan(snapshots, [], []);
    const kept = new Set(plan.keptAnchorIds);
    const remaining = snapshots.filter((s) => kept.has(s.id));
    const latestAfter = remaining.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth)).at(-1)!;

    const before = resolveAnchor('2025-01', 0, latestBefore);
    const after = resolveAnchor('2025-01', 0, latestAfter);
    expect(after).toEqual(before); // same anchor month + balance → identical forecast
  });

  describe('expired occurrence overrides', () => {
    const account = createMockAccount({ id: 'acc-A', startingDate: '2025-01', startingBalance: 1000, planningHorizonMonths: 24 });
    const recurring = createMockRecurringItem({ id: 'rec-1', accountId: 'acc-A', startDate: '2025-01', amount: 100, type: 'expense' });
    const override = (id: string, scheduledDate: string, extra: Partial<PlannedItem> = {}): PlannedItem =>
      createMockPlannedItem({
        id, accountId: 'acc-A', kind: 'one-off', scheduledDate, amount: 250, type: 'expense',
        isRecurringOverride: true, linkedRecurringItemId: 'rec-1', ...extra,
      });
    const planned = [
      override('o-old', '2026-01'),
      override('o-edge', '2026-02'), // anchor 2026-04 − 2 → still inside the engine's window
      override('o-new', '2026-05'),
      createMockPlannedItem({ id: 'p-one-off', accountId: 'acc-A', kind: 'one-off', scheduledDate: '2025-06', amount: 5 }),
    ];
    const anchorSnap = snap({ id: 's-anchor', entityId: 'acc-A', yearMonth: '2026-04', actualBalance: 900 });

    it('prunes only overrides before the anchor month − 2 (never regular planned items)', () => {
      const plan = computeCompactionPlan([anchorSnap], [], [], [{ account, plannedItems: planned }], '2026-09');
      expect(plan.overrides).toEqual([{ accountId: 'acc-A', itemId: 'o-old' }]);
    });

    it('uses genesis as the anchor without a snapshot, and ignores other entities\' snapshots', () => {
      const other = snap({ id: 's-inv', entityType: 'investment', entityId: 'acc-A', yearMonth: '2026-08' });
      const plan = computeCompactionPlan([other], [], [], [{ account, plannedItems: planned }], '2026-09');
      expect(plan.overrides).toEqual([]); // genesis 2025-01 − 2 → nothing expired
    });

    it('clamps a future-dated anchor to the current month', () => {
      expect(expiredOverrideCutoff('2027-01', '2026-09')).toBe('2026-07');
      expect(expiredOverrideCutoff('2026-04', '2026-09')).toBe('2026-02');
    });

    it('INVARIANT: removing the pruned overrides leaves the projection identical', () => {
      const plan = computeCompactionPlan([anchorSnap], [], [], [{ account, plannedItems: planned }], '2026-09');
      const pruned = new Set(plan.overrides.map((o) => o.itemId));
      const before = calculateProjection(account, [recurring], planned, [], undefined, anchorSnap);
      const after = calculateProjection(account, [recurring], planned.filter((p) => !pruned.has(p.id)), [], undefined, anchorSnap);
      expect(after).toEqual(before);
    });
  });
});
