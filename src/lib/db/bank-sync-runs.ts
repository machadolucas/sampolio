/**
 * Enable Banking — sync-run audit log.
 *
 * One capped list per connection (`bank_sync_run`, `seq` 0 = newest) of the
 * most recent sync runs. Used for the "last sync" UI and for debugging.
 * Entries carry only codes/counts/durations — never PII.
 */

import type { BankSyncRun } from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, inTx, listDocs, replaceSeqDocs } from './sqlite/docs';
import { bankSyncRun } from './sqlite/schema';

/** Keep only the most recent runs per connection (bounded growth). */
const MAX_SYNC_RUNS = 50;

const scope = (userId: string, connectionId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  connectionId: assertSafeId(connectionId, 'connectionId'),
});

function readRuns(userId: string, connectionId: string): BankSyncRun[] {
  return listDocs<BankSyncRun>(bankSyncRun, scope(userId, connectionId), 'seq');
}

export async function getBankSyncRuns(
  userId: string,
  connectionId: string
): Promise<BankSyncRun[]> {
  return readRuns(userId, connectionId);
}

export async function getLatestBankSyncRun(
  userId: string,
  connectionId: string
): Promise<BankSyncRun | null> {
  const runs = readRuns(userId, connectionId);
  return runs.length > 0 ? runs[0] : null;
}

/** Prepend a run and trim to the cap. Returns the stored run. */
export async function appendBankSyncRun(
  userId: string,
  connectionId: string,
  run: BankSyncRun
): Promise<BankSyncRun> {
  inTx(() => {
    const runs = [run, ...readRuns(userId, connectionId)].slice(0, MAX_SYNC_RUNS);
    replaceSeqDocs(bankSyncRun, scope(userId, connectionId), runs);
  });
  return run;
}

export async function deleteBankSyncRuns(
  userId: string,
  connectionId: string
): Promise<void> {
  deleteRows(bankSyncRun, scope(userId, connectionId));
}
