import { describe, it, expect } from 'vitest';
import { latestSnapshotsByEntity, snapshotEntityKey } from './latest-snapshots';
import { createMockSnapshot } from '@/test/mocks';

describe('latestSnapshotsByEntity', () => {
  it('keeps the newest yearMonth per entity, keyed by type and id', () => {
    const map = latestSnapshotsByEntity([
      createMockSnapshot({ id: 's1', entityType: 'cash-account', entityId: 'acc', yearMonth: '2026-05' }),
      createMockSnapshot({ id: 's2', entityType: 'cash-account', entityId: 'acc', yearMonth: '2026-07' }),
      createMockSnapshot({ id: 's3', entityType: 'cash-account', entityId: 'acc', yearMonth: '2026-06' }),
      createMockSnapshot({ id: 's4', entityType: 'investment', entityId: 'acc', yearMonth: '2026-01' }),
    ]);
    expect(map[snapshotEntityKey('cash-account', 'acc')].id).toBe('s2');
    // Same id, different entity type — never collides.
    expect(map[snapshotEntityKey('investment', 'acc')].id).toBe('s4');
    expect(Object.keys(map)).toHaveLength(2);
  });

  it('breaks a yearMonth tie like the per-entity read does: the later row in the file wins', () => {
    const map = latestSnapshotsByEntity([
      createMockSnapshot({ id: 'first', entityType: 'debt', entityId: 'd', yearMonth: '2026-03' }),
      createMockSnapshot({ id: 'second', entityType: 'debt', entityId: 'd', yearMonth: '2026-03' }),
    ]);
    expect(map[snapshotEntityKey('debt', 'd')].id).toBe('second');
  });

  it('returns an empty map for no snapshots', () => {
    expect(latestSnapshotsByEntity([])).toEqual({});
  });
});
