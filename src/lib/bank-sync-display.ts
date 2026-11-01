import type { BankConnection } from '@/types';

/** A non-successful run is an attempt, not evidence that this account synced. */
export function getLatestNonSuccessfulAttempt(
  connection: Pick<BankConnection, 'lastSyncAt' | 'lastSyncStatus'>,
): { at: string; status: 'partial' | 'error' } | null {
  if (!connection.lastSyncAt || !connection.lastSyncStatus || connection.lastSyncStatus === 'ok') {
    return null;
  }
  return { at: connection.lastSyncAt, status: connection.lastSyncStatus };
}
