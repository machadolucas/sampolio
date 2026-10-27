import { v4 as uuidv4 } from 'uuid';
import type {
  Receivable,
  ReceivableRepayment,
  CreateReceivableRequest,
  UpdateReceivableRequest,
  CreateRepaymentRequest,
} from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, putDoc } from './sqlite/docs';
import { receivable as receivableTable, receivableRepayment } from './sqlite/schema';

const receivableKey = (userId: string, receivableId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  id: assertSafeId(receivableId),
});
const repaymentScope = (userId: string, receivableId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  receivableId: assertSafeId(receivableId, 'receivableId'),
});
const repaymentKey = (userId: string, receivableId: string, repaymentId: string) => ({
  ...repaymentScope(userId, receivableId),
  id: assertSafeId(repaymentId),
});

function readRepayments(userId: string, receivableId: string): ReceivableRepayment[] {
  const repayments = listDocs<ReceivableRepayment>(receivableRepayment, repaymentScope(userId, receivableId));
  return repayments.sort((a, b) => a.date.localeCompare(b.date));
}

/** The stored balance is a cache: recompute it from the repayments. */
function withCurrentBalance(userId: string, receivable: Receivable): Receivable {
  const totalRepaid = readRepayments(userId, receivable.id).reduce((sum, r) => sum + r.amount, 0);
  return { ...receivable, currentBalance: receivable.initialPrincipal - totalRepaid };
}

// ============================================================
// RECEIVABLES CRUD
// ============================================================

export async function getReceivables(userId: string): Promise<Receivable[]> {
  const receivables = listDocs<Receivable>(receivableTable, { userId: assertSafeId(userId, 'userId') }).map((r) =>
    withCurrentBalance(userId, r)
  );

  return receivables.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function readReceivable(userId: string, receivableId: string): Receivable | null {
  const receivable = getDoc<Receivable>(receivableTable, receivableKey(userId, receivableId));
  return receivable ? withCurrentBalance(userId, receivable) : null;
}

export async function getReceivableById(userId: string, receivableId: string): Promise<Receivable | null> {
  return readReceivable(userId, receivableId);
}

export async function createReceivable(userId: string, data: CreateReceivableRequest): Promise<Receivable> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const receivable: Receivable = {
    id,
    userId,
    name: data.name,
    description: data.description,
    currency: data.currency,
    initialPrincipal: data.initialPrincipal,
    currentBalance: data.initialPrincipal, // No repayments yet
    note: data.note,
    hasInterest: data.hasInterest ?? false,
    annualInterestRate: data.annualInterestRate,
    expectedMonthlyRepayment: data.expectedMonthlyRepayment,
    startDate: data.startDate,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  putDoc(receivableTable, receivableKey(userId, id), receivable);

  return receivable;
}

export async function updateReceivable(
  userId: string,
  receivableId: string,
  updates: UpdateReceivableRequest
): Promise<Receivable | null> {
  return inTx(() => {
    const receivable = readReceivable(userId, receivableId);
    if (!receivable) {
      return null;
    }

    const updatedReceivable: Receivable = {
      ...receivable,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Recalculate current balance if initial principal changed
    // but only if currentBalance wasn't explicitly provided
    if (updates.initialPrincipal !== undefined && !('currentBalance' in updates)) {
      const totalRepaid = readRepayments(userId, receivableId).reduce((sum, r) => sum + r.amount, 0);
      updatedReceivable.currentBalance = updates.initialPrincipal - totalRepaid;
    }

    putDoc(receivableTable, receivableKey(userId, receivableId), updatedReceivable);
    return updatedReceivable;
  });
}

export async function deleteReceivable(userId: string, receivableId: string): Promise<boolean> {
  inTx(() => {
    // Delete all repayments first
    deleteRows(receivableRepayment, repaymentScope(userId, receivableId));
    deleteRows(receivableTable, receivableKey(userId, receivableId));
  });
  return true;
}

// ============================================================
// REPAYMENTS CRUD
// ============================================================

export async function getRepayments(userId: string, receivableId: string): Promise<ReceivableRepayment[]> {
  return readRepayments(userId, receivableId);
}

export async function createRepayment(
  userId: string,
  receivableId: string,
  data: CreateRepaymentRequest
): Promise<ReceivableRepayment> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const repayment: ReceivableRepayment = {
    id,
    receivableId,
    date: data.date,
    amount: data.amount,
    note: data.note,
    linkedAccountId: data.linkedAccountId,
    createdAt: now,
  };

  putDoc(receivableRepayment, repaymentKey(userId, receivableId, id), repayment);

  return repayment;
}

export async function deleteRepayment(
  userId: string,
  receivableId: string,
  repaymentId: string
): Promise<boolean> {
  deleteRows(receivableRepayment, repaymentKey(userId, receivableId, repaymentId));
  return true;
}
