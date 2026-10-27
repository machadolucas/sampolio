import * as crypto from 'crypto';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { assertSafeId } from './encryption';
import { deleteRows, inTx, listRows, nextSeq, putDoc } from './sqlite/docs';
import { balanceSnapshot, reconciliationAdjustment, reconciliationSession } from './sqlite/schema';
import type { BalanceSnapshot, ReconciliationAdjustment, ReconciliationSession, EntityType, AdjustmentCategory } from '@/types';

// Each former aggregate file (`balance-snapshots.enc`,
// `reconciliation-adjustments.enc`, `reconciliation-sessions.enc`) is one row
// per element, `seq` keeping the array order (an upsert keeps its position,
// a new row appends).

interface Positioned<T> {
  seq: number;
  doc: T;
}

function readList<T>(table: SQLiteTable, userId: string): Positioned<T>[] {
  return listRows<T>(table, { userId: assertSafeId(userId, 'userId') }, 'seq').map((r) => ({
    seq: r.keys.seq as number,
    doc: r.doc,
  }));
}

function writeAt<T extends { id: string }>(table: SQLiteTable, userId: string, seq: number, doc: T): void {
  putDoc(table, { userId, id: doc.id, seq }, doc);
}

function append<T extends { id: string }>(table: SQLiteTable, userId: string, doc: T): void {
  writeAt(table, userId, nextSeq(table, { userId }), doc);
}

/** Delete rows by id (one statement each, one transaction). */
function deleteByIds(table: SQLiteTable, userId: string, ids: string[]): number {
  if (ids.length === 0) return 0;
  const uid = assertSafeId(userId, 'userId');
  return inTx(() => [...new Set(ids)].reduce((n, id) => n + deleteRows(table, { userId: uid, id }), 0));
}

// ============================================================
// Balance Snapshots
// ============================================================

function readSnapshots(userId: string): BalanceSnapshot[] {
  return readList<BalanceSnapshot>(balanceSnapshot, userId).map((r) => r.doc);
}

export async function getBalanceSnapshots(userId: string): Promise<BalanceSnapshot[]> {
  return readSnapshots(userId);
}

function snapshotsForEntity(userId: string, entityType: EntityType, entityId: string): BalanceSnapshot[] {
  return readSnapshots(userId).filter(
    s => s.entityType === entityType && s.entityId === entityId
  ).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
}

export async function getSnapshotsForEntity(
  userId: string,
  entityType: EntityType,
  entityId: string
): Promise<BalanceSnapshot[]> {
  return snapshotsForEntity(userId, entityType, entityId);
}

function snapshotsForMonth(userId: string, yearMonth: string): BalanceSnapshot[] {
  return readSnapshots(userId).filter(s => s.yearMonth === yearMonth);
}

export async function getSnapshotsForMonth(
  userId: string,
  yearMonth: string
): Promise<BalanceSnapshot[]> {
  return snapshotsForMonth(userId, yearMonth);
}

export async function getLatestSnapshot(
  userId: string,
  entityType: EntityType,
  entityId: string
): Promise<BalanceSnapshot | null> {
  const snapshots = snapshotsForEntity(userId, entityType, entityId);
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

export async function createBalanceSnapshot(
  userId: string,
  entityType: EntityType,
  entityId: string,
  yearMonth: string,
  expectedBalance: number,
  actualBalance: number,
  source: 'manual' | 'bank-sync' = 'manual',
  // Bank-sync provenance (see BalanceSnapshot). A write without it — e.g. a
  // manual reconciliation replacing a bank-sync row — drops the old values.
  bankProvenance?: Pick<BalanceSnapshot, 'balanceType' | 'balanceAsOf' | 'monthStartBalance'>
): Promise<BalanceSnapshot> {
  return inTx(() => {
    // Check if snapshot already exists for this entity/month
    const existing = readList<BalanceSnapshot>(balanceSnapshot, userId).find(
      r => r.doc.entityType === entityType && r.doc.entityId === entityId && r.doc.yearMonth === yearMonth
    );

    // Last write wins for a given entity/month. A bank-sync reflects the real
    // account balance at sync time, so it supersedes the current month's prior
    // snapshot (manual or an earlier sync) — that is why a linked account's
    // displayed balance and forecast anchor track the bank, not a stale manually
    // entered value. Bank-sync only ever writes the CURRENT month, so historical
    // manual reconciliations are never overwritten. A manual reconciliation
    // likewise overwrites the current bank value (until the next sync), letting
    // the user correct a mid-clearing or otherwise wrong bank balance.

    const snapshot: BalanceSnapshot = {
      id: existing ? existing.doc.id : crypto.randomUUID(),
      userId,
      entityType,
      entityId,
      yearMonth,
      expectedBalance,
      actualBalance,
      variance: actualBalance - expectedBalance,
      source,
      createdAt: new Date().toISOString(),
    };
    if (bankProvenance?.balanceType !== undefined) snapshot.balanceType = bankProvenance.balanceType;
    if (bankProvenance?.balanceAsOf !== undefined) snapshot.balanceAsOf = bankProvenance.balanceAsOf;
    if (bankProvenance?.monthStartBalance !== undefined) {
      snapshot.monthStartBalance = bankProvenance.monthStartBalance;
    }

    if (existing) {
      writeAt(balanceSnapshot, userId, existing.seq, snapshot);
    } else {
      append(balanceSnapshot, userId, snapshot);
    }
    return snapshot;
  });
}

export async function deleteBalanceSnapshot(userId: string, snapshotId: string): Promise<boolean> {
  return deleteByIds(balanceSnapshot, userId, [snapshotId]) > 0;
}

/** Bulk-delete snapshots by id in one transaction. Returns the count removed. */
export async function deleteSnapshotsByIds(userId: string, ids: string[]): Promise<number> {
  return deleteByIds(balanceSnapshot, userId, ids);
}

// ============================================================
// Reconciliation Adjustments
// ============================================================

function readAdjustments(userId: string): ReconciliationAdjustment[] {
  return readList<ReconciliationAdjustment>(reconciliationAdjustment, userId).map((r) => r.doc);
}

function adjustmentsForSnapshot(userId: string, snapshotId: string): ReconciliationAdjustment[] {
  return readAdjustments(userId).filter(a => a.snapshotId === snapshotId);
}

export async function getAdjustmentsForSnapshot(
  userId: string,
  snapshotId: string
): Promise<ReconciliationAdjustment[]> {
  return adjustmentsForSnapshot(userId, snapshotId);
}

export async function getAllAdjustments(userId: string): Promise<ReconciliationAdjustment[]> {
  return readAdjustments(userId);
}

/** Bulk-delete adjustments by id in one transaction. Returns the count removed. */
export async function deleteAdjustmentsByIds(userId: string, ids: string[]): Promise<number> {
  return deleteByIds(reconciliationAdjustment, userId, ids);
}

export async function createAdjustment(
  userId: string,
  snapshotId: string,
  category: AdjustmentCategory,
  amount: number,
  description?: string
): Promise<ReconciliationAdjustment> {
  const adjustment: ReconciliationAdjustment = {
    id: crypto.randomUUID(),
    snapshotId,
    category,
    amount,
    description,
    createdAt: new Date().toISOString(),
  };

  inTx(() => append(reconciliationAdjustment, assertSafeId(userId, 'userId'), adjustment));
  return adjustment;
}

export async function deleteAdjustment(userId: string, adjustmentId: string): Promise<boolean> {
  return deleteByIds(reconciliationAdjustment, userId, [adjustmentId]) > 0;
}

// ============================================================
// Reconciliation Sessions
// ============================================================

function readSessions(userId: string): ReconciliationSession[] {
  return readList<ReconciliationSession>(reconciliationSession, userId).map((r) => r.doc);
}

function sessionForMonth(userId: string, yearMonth: string): ReconciliationSession | null {
  return readSessions(userId).find(s => s.yearMonth === yearMonth) || null;
}

export async function getReconciliationSessions(userId: string): Promise<ReconciliationSession[]> {
  return readSessions(userId).sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
}

export async function getSessionForMonth(
  userId: string,
  yearMonth: string
): Promise<ReconciliationSession | null> {
  return sessionForMonth(userId, yearMonth);
}

export async function getLatestCompletedSession(
  userId: string
): Promise<ReconciliationSession | null> {
  const completed = readSessions(userId)
    .filter(s => s.status === 'completed')
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  return completed.length > 0 ? completed[0] : null;
}

/** Bulk-delete reconciliation sessions by id in one transaction. Returns the count removed. */
export async function deleteSessionsByIds(userId: string, ids: string[]): Promise<number> {
  return deleteByIds(reconciliationSession, userId, ids);
}

export async function createReconciliationSession(
  userId: string,
  yearMonth: string
): Promise<ReconciliationSession> {
  return inTx(() => {
    // Check if session already exists for this month
    const existing = readList<ReconciliationSession>(reconciliationSession, userId).find(
      r => r.doc.yearMonth === yearMonth
    );

    const session: ReconciliationSession = {
      id: existing ? existing.doc.id : crypto.randomUUID(),
      userId,
      yearMonth,
      status: 'in-progress',
      startedAt: new Date().toISOString(),
      snapshots: [],
      adjustments: [],
    };

    if (existing) {
      // Update existing session but keep snapshots if any
      session.snapshots = existing.doc.snapshots;
      session.adjustments = existing.doc.adjustments;
      writeAt(reconciliationSession, userId, existing.seq, session);
    } else {
      append(reconciliationSession, userId, session);
    }
    return session;
  });
}

/** Read-modify-write one session in place (keeps its position). */
function updateSession(
  userId: string,
  sessionId: string,
  mutate: (session: ReconciliationSession) => void
): ReconciliationSession | null {
  return inTx(() => {
    const row = readList<ReconciliationSession>(reconciliationSession, userId).find(r => r.doc.id === sessionId);
    if (!row) return null;
    mutate(row.doc);
    writeAt(reconciliationSession, userId, row.seq, row.doc);
    return row.doc;
  });
}

export async function completeReconciliationSession(
  userId: string,
  sessionId: string
): Promise<ReconciliationSession | null> {
  return updateSession(userId, sessionId, (session) => {
    session.status = 'completed';
    session.completedAt = new Date().toISOString();
  });
}

export async function updateSessionSnapshots(
  userId: string,
  sessionId: string,
  snapshots: BalanceSnapshot[]
): Promise<ReconciliationSession | null> {
  return updateSession(userId, sessionId, (session) => {
    session.snapshots = snapshots;
  });
}

export async function updateSessionAdjustments(
  userId: string,
  sessionId: string,
  adjustments: ReconciliationAdjustment[]
): Promise<ReconciliationSession | null> {
  return updateSession(userId, sessionId, (session) => {
    session.adjustments = adjustments;
  });
}

// ============================================================
// Utility Functions
// ============================================================

export async function getReconciliationSummary(
  userId: string,
  yearMonth: string
): Promise<{
  isReconciled: boolean;
  totalVariance: number;
  entitiesReconciled: number;
  adjustmentsByCategory: Record<AdjustmentCategory, number>;
  lastReconciledAt?: string;
}> {
  const session = sessionForMonth(userId, yearMonth);
  const snapshots = snapshotsForMonth(userId, yearMonth);
  
  const adjustmentsByCategory: Record<AdjustmentCategory, number> = {
    'untracked-income': 0,
    'untracked-expense': 0,
    'valuation-change': 0,
    'interest-adjustment': 0,
    'data-correction': 0,
    'other': 0,
  };
  
  // Aggregate adjustments
  for (const snapshot of snapshots) {
    const adjustments = adjustmentsForSnapshot(userId, snapshot.id);
    for (const adj of adjustments) {
      adjustmentsByCategory[adj.category] += adj.amount;
    }
  }
  
  return {
    isReconciled: session?.status === 'completed',
    totalVariance: snapshots.reduce((sum, s) => sum + s.variance, 0),
    entitiesReconciled: snapshots.length,
    adjustmentsByCategory,
    lastReconciledAt: session?.completedAt,
  };
}
