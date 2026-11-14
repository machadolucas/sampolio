import type { BankConnection } from '@/types';

export function isReferenceReviewRequired(error?: string | null): boolean {
  return error === 'TRANSACTION_REFERENCE_CHANGED';
}

export const REFERENCE_REVIEW_MESSAGE =
  'A bank transaction may have changed its reference. The affected account’s saved data was left unchanged to avoid duplicates. It needs review; reconnecting is not a repair for this warning.';

/** A non-successful run is an attempt, not evidence that this account synced. */
export function getLatestNonSuccessfulAttempt(
  connection: Pick<BankConnection, 'lastSyncAt' | 'lastSyncStatus'>,
): { at: string; status: 'partial' | 'error' } | null {
  if (!connection.lastSyncAt || !connection.lastSyncStatus || connection.lastSyncStatus === 'ok') {
    return null;
  }
  return { at: connection.lastSyncAt, status: connection.lastSyncStatus };
}
