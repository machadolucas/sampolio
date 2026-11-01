import { describe, expect, it } from 'vitest';
import { getLatestNonSuccessfulAttempt } from './bank-sync-display';

describe('getLatestNonSuccessfulAttempt', () => {
  it('returns failed and partial connection attempts separately from link success timestamps', () => {
    expect(getLatestNonSuccessfulAttempt({
      lastSyncAt: '2026-11-01T10:30:00.000Z',
      lastSyncStatus: 'partial',
    })).toEqual({ at: '2026-11-01T10:30:00.000Z', status: 'partial' });
    expect(getLatestNonSuccessfulAttempt({
      lastSyncAt: '2026-11-01T10:35:00.000Z',
      lastSyncStatus: 'error',
    })).toEqual({ at: '2026-11-01T10:35:00.000Z', status: 'error' });
  });

  it('does not present successful or timestamp-free connections as failed attempts', () => {
    expect(getLatestNonSuccessfulAttempt({
      lastSyncAt: '2026-11-01T10:30:00.000Z',
      lastSyncStatus: 'ok',
    })).toBeNull();
    expect(getLatestNonSuccessfulAttempt({ lastSyncStatus: 'error' })).toBeNull();
  });
});
