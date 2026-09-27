/**
 * Pure helpers for history compaction (no I/O). Decides which reconciliation
 * records are safe to prune WITHOUT changing any projection.
 *
 * Invariant: projections only ever read the *latest* snapshot per entity (the
 * anchor — see resolveAnchor in projection.ts). So keeping the latest snapshot
 * per (entityType, entityId) and dropping the rest leaves every forecast
 * byte-identical. Sessions/adjustments are historical logs the engine never reads.
 *
 * Expired per-occurrence overrides (planned rows with `isRecurringOverride`)
 * are anchor-gated the same way: `calculateProjection` drops overrides whose
 * `scheduledDate` is before (projection start − 2 months), and the projection
 * starts at the account's anchor (`resolveAnchor`), which compaction never
 * moves because it keeps each entity's latest snapshot.
 */
import type {
  BalanceSnapshot,
  FinancialAccount,
  PlannedItem,
  ReconciliationAdjustment,
  ReconciliationSession,
  YearMonth,
} from '@/types';
import { addMonths, compareYearMonths, getCurrentYearMonth, resolveAnchor } from '@/lib/projection';
import { latestSnapshotsByEntity, snapshotEntityKey } from '@/lib/latest-snapshots';

export interface CompactionPlan {
  snapshotIds: string[]; // prunable: older-than-latest per entity
  adjustmentIds: string[]; // prunable: orphaned by a pruned snapshot
  sessionIds: string[]; // prunable: older than the latest reconciliation month
  keptAnchorIds: string[]; // the latest snapshot per entity (always retained)
  overrides: Array<{ accountId: string; itemId: string }>; // prunable: expired occurrence overrides
}

/** A cash account with its planned items, for the expired-override scan. */
export interface CompactionAccountInput {
  account: Pick<FinancialAccount, 'id' | 'startingDate' | 'startingBalance'>;
  plannedItems: PlannedItem[];
}

/**
 * Overrides dated before this month are invisible to every projection of the
 * account: `calculateProjection` ignores them (its cutoff is the anchor month
 * − 2) and card-bill forecasts (`taggedSpendForMonth`) only read spend months
 * from the open cycle on. Clamping the anchor to the current month keeps that
 * true even for an anchor dated in the future.
 */
export function expiredOverrideCutoff(anchorMonth: YearMonth, currentMonth: YearMonth = getCurrentYearMonth()): YearMonth {
  const base = compareYearMonths(anchorMonth, currentMonth) < 0 ? anchorMonth : currentMonth;
  return addMonths(base, -2);
}

export function computeCompactionPlan(
  snapshots: BalanceSnapshot[],
  adjustments: ReconciliationAdjustment[],
  sessions: ReconciliationSession[],
  accounts: CompactionAccountInput[] = [],
  currentMonth: YearMonth = getCurrentYearMonth()
): CompactionPlan {
  // Keep the latest snapshot per entity; track the overall latest month.
  const byEntity = new Map<string, BalanceSnapshot[]>();
  for (const s of snapshots) {
    const key = `${s.entityType}:${s.entityId}`;
    const arr = byEntity.get(key) ?? [];
    arr.push(s);
    byEntity.set(key, arr);
  }

  const keptAnchorIds: string[] = [];
  let latestMonth = '';
  for (const arr of byEntity.values()) {
    arr.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    const latest = arr[arr.length - 1];
    keptAnchorIds.push(latest.id);
    if (latest.yearMonth > latestMonth) latestMonth = latest.yearMonth;
  }

  const keepSet = new Set(keptAnchorIds);
  const prunableSnapshots = snapshots.filter((s) => !keepSet.has(s.id));
  const prunableSnapshotIds = new Set(prunableSnapshots.map((s) => s.id));

  const adjustmentIds = adjustments
    .filter((a) => prunableSnapshotIds.has(a.snapshotId))
    .map((a) => a.id);

  // Sessions strictly before the latest reconciliation month are pure history.
  const sessionIds = latestMonth
    ? sessions.filter((s) => s.yearMonth < latestMonth).map((s) => s.id)
    : [];

  // Anchor per account = the same latest cash-account snapshot the engine
  // reads (kept above), else genesis.
  const latest = latestSnapshotsByEntity(snapshots);
  const overrides: CompactionPlan['overrides'] = [];
  for (const { account, plannedItems } of accounts) {
    const anchor = resolveAnchor(
      account.startingDate,
      account.startingBalance,
      latest[snapshotEntityKey('cash-account', account.id)]
    );
    const cutoff = expiredOverrideCutoff(anchor.startMonth, currentMonth);
    for (const p of plannedItems) {
      if (p.isRecurringOverride && p.scheduledDate && compareYearMonths(p.scheduledDate, cutoff) < 0) {
        overrides.push({ accountId: account.id, itemId: p.id });
      }
    }
  }

  return {
    snapshotIds: prunableSnapshots.map((s) => s.id),
    adjustmentIds,
    sessionIds,
    keptAnchorIds,
    overrides,
  };
}
