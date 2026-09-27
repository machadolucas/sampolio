/**
 * Latest balance snapshot per entity, computed in one pass over the whole
 * snapshot list (pure; shared by the cached batch read in `db/cached.ts` and
 * its tests).
 *
 * Mirrors `getLatestSnapshot` in `src/lib/db/reconciliation.ts`: the entity's
 * snapshots sorted ascending by `yearMonth` (stable), last one wins — so on a
 * `yearMonth` tie the row that appears later in the file wins.
 */

import type { BalanceSnapshot, EntityType } from '@/types';

/** Map key for one entity: `"{entityType}:{entityId}"`. */
export function snapshotEntityKey(entityType: EntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

export function latestSnapshotsByEntity(snapshots: BalanceSnapshot[]): Record<string, BalanceSnapshot> {
  const out: Record<string, BalanceSnapshot> = {};
  for (const s of snapshots) {
    const key = snapshotEntityKey(s.entityType, s.entityId);
    const prev = out[key];
    if (!prev || s.yearMonth.localeCompare(prev.yearMonth) >= 0) out[key] = s;
  }
  return out;
}
