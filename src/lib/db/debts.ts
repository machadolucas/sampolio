import { v4 as uuidv4 } from 'uuid';
import type {
  Debt,
  DebtReferenceRate,
  DebtExtraPayment,
  CreateDebtRequest,
  UpdateDebtRequest,
} from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, putDoc } from './sqlite/docs';
import { debt as debtTable, debtExtraPayment, debtReferenceRate } from './sqlite/schema';

const debtKey = (userId: string, debtId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  id: assertSafeId(debtId),
});
const childScope = (userId: string, debtId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  debtId: assertSafeId(debtId, 'debtId'),
});
const childKey = (userId: string, debtId: string, id: string) => ({
  ...childScope(userId, debtId),
  id: assertSafeId(id),
});

function readReferenceRates(userId: string, debtId: string): DebtReferenceRate[] {
  const rates = listDocs<DebtReferenceRate>(debtReferenceRate, childScope(userId, debtId));
  return rates.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
}

// ============================================================
// DEBTS CRUD
// ============================================================

export async function getDebts(userId: string): Promise<Debt[]> {
  const debts = listDocs<Debt>(debtTable, { userId: assertSafeId(userId, 'userId') });

  return debts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getDebtById(userId: string, debtId: string): Promise<Debt | null> {
  return getDoc<Debt>(debtTable, debtKey(userId, debtId));
}

export async function createDebt(userId: string, data: CreateDebtRequest): Promise<Debt> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const debt: Debt = {
    id,
    userId,
    name: data.name,
    description: data.description,
    currency: data.currency,
    debtType: data.debtType,
    initialPrincipal: data.initialPrincipal,
    startDate: data.startDate,
    // Amortized loan fields
    interestModelType: data.interestModelType ?? 'none',
    fixedInterestRate: data.fixedInterestRate,
    referenceRateMargin: data.referenceRateMargin,
    rateResetFrequency: data.rateResetFrequency,
    monthlyPayment: data.monthlyPayment,
    // Fixed-installment fields
    installmentAmount: data.installmentAmount,
    totalInstallments: data.totalInstallments,
    remainingInstallments: data.totalInstallments,
    // Link to cash account
    linkedAccountId: data.linkedAccountId,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  putDoc(debtTable, debtKey(userId, id), debt);

  return debt;
}

export async function updateDebt(
  userId: string,
  debtId: string,
  updates: UpdateDebtRequest
): Promise<Debt | null> {
  return inTx(() => {
    const debt = getDoc<Debt>(debtTable, debtKey(userId, debtId));
    if (!debt) {
      return null;
    }

    const updatedDebt: Debt = {
      ...debt,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    putDoc(debtTable, debtKey(userId, debtId), updatedDebt);
    return updatedDebt;
  });
}

export async function deleteDebt(userId: string, debtId: string): Promise<boolean> {
  inTx(() => {
    deleteRows(debtReferenceRate, childScope(userId, debtId));
    deleteRows(debtExtraPayment, childScope(userId, debtId));
    deleteRows(debtTable, debtKey(userId, debtId));
  });
  return true;
}

// ============================================================
// REFERENCE RATES CRUD
// ============================================================

export async function getReferenceRates(userId: string, debtId: string): Promise<DebtReferenceRate[]> {
  return readReferenceRates(userId, debtId);
}

export async function setReferenceRate(
  userId: string,
  debtId: string,
  yearMonth: string,
  rate: number
): Promise<DebtReferenceRate> {
  return inTx(() => {
    // Check if rate already exists for this month
    const existing = readReferenceRates(userId, debtId).find((r) => r.yearMonth === yearMonth);

    if (existing) {
      // Update existing
      const updatedRate: DebtReferenceRate = { ...existing, rate };
      putDoc(debtReferenceRate, childKey(userId, debtId, existing.id), updatedRate);
      return updatedRate;
    }

    // Create new
    const id = uuidv4();
    const now = new Date().toISOString();

    const referenceRate: DebtReferenceRate = {
      id,
      debtId,
      yearMonth,
      rate,
      createdAt: now,
    };

    putDoc(debtReferenceRate, childKey(userId, debtId, id), referenceRate);
    return referenceRate;
  });
}

export async function deleteReferenceRate(
  userId: string,
  debtId: string,
  rateId: string
): Promise<boolean> {
  deleteRows(debtReferenceRate, childKey(userId, debtId, rateId));
  return true;
}

// ============================================================
// EXTRA PAYMENTS CRUD
// ============================================================

export async function getExtraPayments(userId: string, debtId: string): Promise<DebtExtraPayment[]> {
  const payments = listDocs<DebtExtraPayment>(debtExtraPayment, childScope(userId, debtId));

  return payments.sort((a, b) => a.date.localeCompare(b.date));
}

export async function createExtraPayment(
  userId: string,
  debtId: string,
  date: string,
  amount: number,
  note?: string
): Promise<DebtExtraPayment> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const payment: DebtExtraPayment = {
    id,
    debtId,
    date,
    amount,
    note,
    createdAt: now,
  };

  putDoc(debtExtraPayment, childKey(userId, debtId, id), payment);

  return payment;
}

export async function deleteExtraPayment(
  userId: string,
  debtId: string,
  paymentId: string
): Promise<boolean> {
  deleteRows(debtExtraPayment, childKey(userId, debtId, paymentId));
  return true;
}
