'use server';

import { z } from 'zod';
import { auth } from '@/lib/auth';
import * as reconciliationDb from '@/lib/db/reconciliation';
import type { EntityType, AdjustmentCategory, BalanceSnapshot, ReconciliationAdjustment, ReconciliationSession } from '@/types';

// ============================================================
// Validation Schemas
// ============================================================

const EntityTypeSchema = z.enum(['cash-account', 'investment', 'receivable', 'debt']);
const AdjustmentCategorySchema = z.enum([
  'untracked-income',
  'untracked-expense',
  'valuation-change',
  'interest-adjustment',
  'data-correction',
  'other',
]);

const CreateSnapshotSchema = z.object({
  entityType: EntityTypeSchema,
  entityId: z.string().min(1),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  expectedBalance: z.number(),
  actualBalance: z.number(),
});

const CreateAdjustmentSchema = z.object({
  snapshotId: z.string().min(1),
  category: AdjustmentCategorySchema,
  amount: z.number(),
  description: z.string().optional(),
});

const YearMonthSchema = z.string().regex(/^\d{4}-\d{2}$/);

// ============================================================
// Helper Functions
// ============================================================

async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  return session.user.id;
}

// ============================================================
// Balance Snapshot Actions
// ============================================================

export async function getBalanceSnapshots(): Promise<{
  success: boolean;
  data?: BalanceSnapshot[];
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const snapshots = await reconciliationDb.getBalanceSnapshots(userId);
    return { success: true, data: snapshots };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getSnapshotsForEntity(
  entityType: EntityType,
  entityId: string
): Promise<{
  success: boolean;
  data?: BalanceSnapshot[];
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const validated = EntityTypeSchema.parse(entityType);
    const snapshots = await reconciliationDb.getSnapshotsForEntity(userId, validated, entityId);
    return { success: true, data: snapshots };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getSnapshotsForMonth(
  yearMonth: string
): Promise<{
  success: boolean;
  data?: BalanceSnapshot[];
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    YearMonthSchema.parse(yearMonth);
    const snapshots = await reconciliationDb.getSnapshotsForMonth(userId, yearMonth);
    return { success: true, data: snapshots };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getLatestSnapshot(
  entityType: EntityType,
  entityId: string
): Promise<{
  success: boolean;
  data?: BalanceSnapshot | null;
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const validated = EntityTypeSchema.parse(entityType);
    const snapshot = await reconciliationDb.getLatestSnapshot(userId, validated, entityId);
    return { success: true, data: snapshot };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function createBalanceSnapshot(
  data: z.infer<typeof CreateSnapshotSchema>
): Promise<{
  success: boolean;
  data?: BalanceSnapshot;
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const validated = CreateSnapshotSchema.parse(data);
    const snapshot = await reconciliationDb.createBalanceSnapshot(
      userId,
      validated.entityType,
      validated.entityId,
      validated.yearMonth,
      validated.expectedBalance,
      validated.actualBalance
    );
    return { success: true, data: snapshot };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function deleteBalanceSnapshot(
  snapshotId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const deleted = await reconciliationDb.deleteBalanceSnapshot(userId, snapshotId);
    if (!deleted) {
      return { success: false, error: 'Snapshot not found' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================
// Reconciliation Adjustment Actions
// ============================================================

export async function getAdjustmentsForSnapshot(
  snapshotId: string
): Promise<{
  success: boolean;
  data?: ReconciliationAdjustment[];
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const adjustments = await reconciliationDb.getAdjustmentsForSnapshot(userId, snapshotId);
    return { success: true, data: adjustments };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function createAdjustment(
  data: z.infer<typeof CreateAdjustmentSchema>
): Promise<{
  success: boolean;
  data?: ReconciliationAdjustment;
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const validated = CreateAdjustmentSchema.parse(data);
    const adjustment = await reconciliationDb.createAdjustment(
      userId,
      validated.snapshotId,
      validated.category,
      validated.amount,
      validated.description
    );
    return { success: true, data: adjustment };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function deleteAdjustment(
  adjustmentId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const deleted = await reconciliationDb.deleteAdjustment(userId, adjustmentId);
    if (!deleted) {
      return { success: false, error: 'Adjustment not found' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================
// Reconciliation Session Actions
// ============================================================

export async function getReconciliationSessions(): Promise<{
  success: boolean;
  data?: ReconciliationSession[];
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const sessions = await reconciliationDb.getReconciliationSessions(userId);
    return { success: true, data: sessions };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getSessionForMonth(
  yearMonth: string
): Promise<{
  success: boolean;
  data?: ReconciliationSession | null;
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    YearMonthSchema.parse(yearMonth);
    const session = await reconciliationDb.getSessionForMonth(userId, yearMonth);
    return { success: true, data: session };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getLatestCompletedSession(): Promise<{
  success: boolean;
  data?: ReconciliationSession | null;
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const session = await reconciliationDb.getLatestCompletedSession(userId);
    return { success: true, data: session };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function startReconciliationSession(
  yearMonth: string
): Promise<{
  success: boolean;
  data?: ReconciliationSession;
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    YearMonthSchema.parse(yearMonth);
    const session = await reconciliationDb.createReconciliationSession(userId, yearMonth);
    return { success: true, data: session };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function completeReconciliationSession(
  sessionId: string
): Promise<{
  success: boolean;
  data?: ReconciliationSession | null;
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const session = await reconciliationDb.completeReconciliationSession(userId, sessionId);
    return { success: true, data: session };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function updateSessionSnapshots(
  sessionId: string,
  snapshots: BalanceSnapshot[]
): Promise<{
  success: boolean;
  data?: ReconciliationSession | null;
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    const session = await reconciliationDb.updateSessionSnapshots(userId, sessionId, snapshots);
    return { success: true, data: session };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================
// Reconciliation Summary
// ============================================================

export async function getReconciliationSummary(
  yearMonth: string
): Promise<{
  success: boolean;
  data?: {
    isReconciled: boolean;
    totalVariance: number;
    entitiesReconciled: number;
    adjustmentsByCategory: Record<AdjustmentCategory, number>;
    lastReconciledAt?: string;
  };
  error?: string;
}> {
  try {
    const userId = await getCurrentUser();
    YearMonthSchema.parse(yearMonth);
    const summary = await reconciliationDb.getReconciliationSummary(userId, yearMonth);
    return { success: true, data: summary };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
