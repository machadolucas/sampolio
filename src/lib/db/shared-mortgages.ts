/**
 * Shared Mortgage storage layer.
 *
 * Unlike every other entity (scoped to a single user's directory), a mortgage is
 * SHARED by a set of members. It lives in global, non-user-scoped tables; access control is enforced in the action
 * layer via the `members` list. A per-user reverse index maps userId → mortgageIds
 * so reads don't have to scan every shared mortgage.
 *
 * Tables (`sqlite/schema/finance.ts`): `mortgage` (SharedMortgage, loans +
 * members embedded); `mortgage_rate` (Euribor reset history), `mortgage_cost`
 * (insurance / invoicing / service fee history), `mortgage_extra_payment`,
 * `mortgage_balance_snapshot` (drift re-anchors), `mortgage_actual` (imported
 * bank history), all keyed by mortgageId; `mortgage_member_index` (userId →
 * mortgageIds reverse index, `seq` = list order).
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  SharedMortgage,
  MortgageMember,
  MortgageLoan,
  MortgageRateEntry,
  MortgageCostEntry,
  MortgageExtraPayment,
  MortgageBalanceSnapshot,
  CreateMortgageRequest,
  UpdateMortgageRequest,
  UpdateMortgageLoanRequest,
  UpdateMortgageMemberRequest,
  SetMortgageRateRequest,
  SetMortgageCostRequest,
  CreateMortgageExtraPaymentRequest,
  CreateMortgageBalanceSnapshotRequest,
  MortgageActualEntry,
  MortgageActualInput,
  MortgageDayCount,
  MortgagePaymentMode,
} from '@/types';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, listRows, nextSeq, putDoc } from './sqlite/docs';
import {
  mortgage as mortgageTable,
  mortgageActual,
  mortgageBalanceSnapshot,
  mortgageCost,
  mortgageExtraPayment,
  mortgageMemberIndex,
  mortgageRate,
} from './sqlite/schema';

// ============================================================
// KEYS
// ============================================================

const mortgageKey = (mortgageId: string) => ({ id: assertSafeId(mortgageId, 'mortgageId') });
const childScope = (mortgageId: string) => ({ mortgageId: assertSafeId(mortgageId, 'mortgageId') });
const childKey = (mortgageId: string, id: string) => ({ ...childScope(mortgageId), id: assertSafeId(id) });

const SUB_COLLECTIONS: SQLiteTable[] = [
  mortgageRate,
  mortgageCost,
  mortgageExtraPayment,
  mortgageBalanceSnapshot,
  mortgageActual,
];

function readMortgage(mortgageId: string): SharedMortgage | null {
  return getDoc<SharedMortgage>(mortgageTable, mortgageKey(mortgageId));
}

function writeMortgage(mortgage: SharedMortgage): void {
  putDoc(mortgageTable, mortgageKey(mortgage.id), mortgage);
}

// ============================================================
// REVERSE MEMBER INDEX
// ============================================================

function readMortgageIds(userId: string): string[] {
  return listRows(mortgageMemberIndex, { userId: assertSafeId(userId, 'userId') }, 'seq').map(
    (r) => r.keys.mortgageId as string
  );
}

export async function getMortgageIdsForUser(userId: string): Promise<string[]> {
  return readMortgageIds(userId);
}

function addUserToMortgageIndex(userId: string, mortgageId: string): void {
  const uid = assertSafeId(userId, 'userId');
  if (!readMortgageIds(uid).includes(mortgageId)) {
    putDoc(mortgageMemberIndex, { userId: uid, mortgageId, seq: nextSeq(mortgageMemberIndex, { userId: uid }) });
  }
}

function removeUserFromMortgageIndex(userId: string, mortgageId: string): void {
  deleteRows(mortgageMemberIndex, { userId: assertSafeId(userId, 'userId'), mortgageId });
}

// ============================================================
// MORTGAGE CRUD
// ============================================================

export async function getMortgageById(mortgageId: string): Promise<SharedMortgage | null> {
  return readMortgage(mortgageId);
}

export async function getMortgagesForUser(userId: string): Promise<SharedMortgage[]> {
  return readMortgageIds(userId)
    .map((id) => readMortgage(id))
    .filter((m): m is SharedMortgage => m !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function buildLoan(input: CreateMortgageRequest['loans'][number]): MortgageLoan {
  return {
    id: uuidv4(),
    label: input.label,
    kind: input.kind,
    initialPrincipal: input.initialPrincipal,
    startDate: input.startDate,
    originalTermMonths: input.originalTermMonths,
    paymentMode: (input.paymentMode ?? 'annuity-fixed-term') as MortgagePaymentMode,
    margin: input.margin,
    dayCount: (input.dayCount ?? 'actual/360') as MortgageDayCount,
    paymentDayOfMonth: input.paymentDayOfMonth,
    currentMonthlyPayment: input.currentMonthlyPayment,
    aspSubsidy: input.aspSubsidy,
  };
}

/**
 * Create a shared mortgage. `members` must be fully resolved (email→userId done
 * in the action layer); the creator is added as an 'owner'. Genesis rate/cost
 * schedules are written as sub-collection entries, all in one transaction.
 */
export async function createMortgage(
  creator: { userId: string; email: string; name: string },
  data: CreateMortgageRequest,
  resolvedMembers: MortgageMember[]
): Promise<SharedMortgage> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const creatorMember: MortgageMember = {
    userId: creator.userId,
    email: creator.email,
    name: creator.name,
    role: 'owner',
    initialPayment: data.creatorInitialPayment,
    loanSharePercent: data.creatorLoanSharePercent,
    ownershipTargetPercent: data.creatorOwnershipTargetPercent,
  };

  const members = [creatorMember, ...resolvedMembers.filter((m) => m.userId !== creator.userId)];

  const mortgage: SharedMortgage = {
    id,
    name: data.name,
    currency: data.currency,
    housePrice: data.housePrice,
    rateResetMonth: data.rateResetMonth ?? 12,
    rateResetDay: data.rateResetDay ?? 14,
    loans: data.loans.map(buildLoan),
    members,
    isArchived: false,
    createdBy: creator.userId,
    createdAt: now,
    updatedAt: now,
    updatedBy: creator.userId,
  };

  inTx(() => {
    writeMortgage(mortgage);

    // Genesis schedules
    for (const r of data.rates ?? []) {
      upsertRate(id, { effectiveDate: r.effectiveDate, euriborRate: r.euriborRate, note: r.note });
    }
    for (const c of data.costs ?? []) {
      upsertCost(id, c);
    }

    // Reverse index for every member
    for (const m of members) addUserToMortgageIndex(m.userId, id);
  });

  return mortgage;
}

/** Read-modify-write the mortgage doc in one transaction. */
function mutateMortgage(
  mortgageId: string,
  next: (mortgage: SharedMortgage) => SharedMortgage
): SharedMortgage | null {
  return inTx(() => {
    const mortgage = readMortgage(mortgageId);
    if (!mortgage) return null;
    const updated = next(mortgage);
    writeMortgage(updated);
    return updated;
  });
}

export async function updateMortgage(
  mortgageId: string,
  updates: UpdateMortgageRequest,
  byUserId: string
): Promise<SharedMortgage | null> {
  return mutateMortgage(mortgageId, (mortgage) => ({
    ...mortgage,
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy: byUserId,
  }));
}

export async function updateMortgageLoan(
  mortgageId: string,
  loanId: string,
  updates: UpdateMortgageLoanRequest,
  byUserId: string
): Promise<SharedMortgage | null> {
  return mutateMortgage(mortgageId, (mortgage) => ({
    ...mortgage,
    loans: mortgage.loans.map((l) => (l.id === loanId ? { ...l, ...updates, id: l.id } : l)),
    updatedAt: new Date().toISOString(),
    updatedBy: byUserId,
  }));
}

export async function deleteMortgage(mortgageId: string): Promise<boolean> {
  inTx(() => {
    const mortgage = readMortgage(mortgageId);
    // Cascade sub-collections
    for (const table of SUB_COLLECTIONS) deleteRows(table, childScope(mortgageId));
    deleteRows(mortgageTable, mortgageKey(mortgageId));
    // Clean each member's reverse index
    if (mortgage) {
      for (const m of mortgage.members) removeUserFromMortgageIndex(m.userId, mortgageId);
    }
  });
  return true;
}

// ============================================================
// MEMBERS
// ============================================================

export async function addMortgageMember(
  mortgageId: string,
  member: MortgageMember
): Promise<SharedMortgage | null> {
  return inTx(() => {
    const mortgage = readMortgage(mortgageId);
    if (!mortgage) return null;
    if (mortgage.members.some((m) => m.userId === member.userId)) return mortgage; // already a member
    const updated: SharedMortgage = {
      ...mortgage,
      members: [...mortgage.members, member],
      updatedAt: new Date().toISOString(),
    };
    writeMortgage(updated);
    addUserToMortgageIndex(member.userId, mortgageId);
    return updated;
  });
}

export async function removeMortgageMember(
  mortgageId: string,
  userId: string
): Promise<SharedMortgage | null> {
  return inTx(() => {
    const updated = mutateMortgage(mortgageId, (mortgage) => ({
      ...mortgage,
      members: mortgage.members.filter((m) => m.userId !== userId),
      updatedAt: new Date().toISOString(),
    }));
    if (updated) removeUserFromMortgageIndex(userId, mortgageId);
    return updated;
  });
}

export async function updateMortgageMember(
  mortgageId: string,
  userId: string,
  updates: UpdateMortgageMemberRequest
): Promise<SharedMortgage | null> {
  return mutateMortgage(mortgageId, (mortgage) => ({
    ...mortgage,
    members: mortgage.members.map((m) => (m.userId === userId ? { ...m, ...updates } : m)),
    updatedAt: new Date().toISOString(),
  }));
}

// ============================================================
// RATES (Euribor schedule)
// ============================================================

function readRates(mortgageId: string): MortgageRateEntry[] {
  return listDocs<MortgageRateEntry>(mortgageRate, childScope(mortgageId)).sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate)
  );
}

export async function getRates(mortgageId: string): Promise<MortgageRateEntry[]> {
  return readRates(mortgageId);
}

function upsertRate(mortgageId: string, data: SetMortgageRateRequest): MortgageRateEntry {
  return inTx(() => {
    const existing = readRates(mortgageId).find((r) => r.effectiveDate === data.effectiveDate);
    if (existing) {
      const updated: MortgageRateEntry = { ...existing, euriborRate: data.euriborRate, note: data.note };
      putDoc(mortgageRate, childKey(mortgageId, existing.id), updated);
      return updated;
    }
    const entry: MortgageRateEntry = {
      id: uuidv4(),
      mortgageId,
      effectiveDate: data.effectiveDate,
      euriborRate: data.euriborRate,
      note: data.note,
      createdAt: new Date().toISOString(),
    };
    putDoc(mortgageRate, childKey(mortgageId, entry.id), entry);
    return entry;
  });
}

export async function setRate(
  mortgageId: string,
  data: SetMortgageRateRequest
): Promise<MortgageRateEntry> {
  return upsertRate(mortgageId, data);
}

export async function deleteRate(mortgageId: string, rateId: string): Promise<boolean> {
  deleteRows(mortgageRate, childKey(mortgageId, rateId));
  return true;
}

// ============================================================
// COSTS (insurance / invoicing / service fee schedule)
// ============================================================

function readCosts(mortgageId: string): MortgageCostEntry[] {
  return listDocs<MortgageCostEntry>(mortgageCost, childScope(mortgageId)).sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate)
  );
}

export async function getCosts(mortgageId: string): Promise<MortgageCostEntry[]> {
  return readCosts(mortgageId);
}

function upsertCost(mortgageId: string, data: SetMortgageCostRequest): MortgageCostEntry {
  return inTx(() => {
    // Upsert by type + loanId + effectiveDate
    const existing = readCosts(mortgageId).find(
      (c) => c.type === data.type && c.loanId === data.loanId && c.effectiveDate === data.effectiveDate
    );
    if (existing) {
      const updated: MortgageCostEntry = { ...existing, amount: data.amount, note: data.note };
      putDoc(mortgageCost, childKey(mortgageId, existing.id), updated);
      return updated;
    }
    const entry: MortgageCostEntry = {
      id: uuidv4(),
      mortgageId,
      type: data.type,
      loanId: data.loanId,
      effectiveDate: data.effectiveDate,
      amount: data.amount,
      note: data.note,
      createdAt: new Date().toISOString(),
    };
    putDoc(mortgageCost, childKey(mortgageId, entry.id), entry);
    return entry;
  });
}

export async function setCost(
  mortgageId: string,
  data: SetMortgageCostRequest
): Promise<MortgageCostEntry> {
  return upsertCost(mortgageId, data);
}

export async function deleteCost(mortgageId: string, costId: string): Promise<boolean> {
  deleteRows(mortgageCost, childKey(mortgageId, costId));
  return true;
}

// ============================================================
// EXTRA PAYMENTS
// ============================================================

export async function getExtraPayments(mortgageId: string): Promise<MortgageExtraPayment[]> {
  return listDocs<MortgageExtraPayment>(mortgageExtraPayment, childScope(mortgageId)).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

export async function createExtraPayment(
  mortgageId: string,
  data: CreateMortgageExtraPaymentRequest
): Promise<MortgageExtraPayment> {
  const entry: MortgageExtraPayment = {
    id: uuidv4(),
    mortgageId,
    loanId: data.loanId,
    date: data.date,
    amount: data.amount,
    mode: data.mode,
    note: data.note,
    createdAt: new Date().toISOString(),
  };
  putDoc(mortgageExtraPayment, childKey(mortgageId, entry.id), entry);
  return entry;
}

export async function deleteExtraPayment(mortgageId: string, paymentId: string): Promise<boolean> {
  deleteRows(mortgageExtraPayment, childKey(mortgageId, paymentId));
  return true;
}

// ============================================================
// DRIFT SNAPSHOTS
// ============================================================

function readBalanceSnapshots(mortgageId: string): MortgageBalanceSnapshot[] {
  return listDocs<MortgageBalanceSnapshot>(mortgageBalanceSnapshot, childScope(mortgageId)).sort((a, b) =>
    a.yearMonth.localeCompare(b.yearMonth)
  );
}

export async function getBalanceSnapshots(mortgageId: string): Promise<MortgageBalanceSnapshot[]> {
  return readBalanceSnapshots(mortgageId);
}

export async function createBalanceSnapshot(
  mortgageId: string,
  data: CreateMortgageBalanceSnapshotRequest
): Promise<MortgageBalanceSnapshot> {
  return inTx(() => {
    // Upsert by loanId + yearMonth
    const existing = readBalanceSnapshots(mortgageId).find(
      (s) => s.loanId === data.loanId && s.yearMonth === data.yearMonth
    );
    if (existing) {
      const updated: MortgageBalanceSnapshot = { ...existing, actualBalance: data.actualBalance, note: data.note };
      putDoc(mortgageBalanceSnapshot, childKey(mortgageId, existing.id), updated);
      return updated;
    }
    const entry: MortgageBalanceSnapshot = {
      id: uuidv4(),
      mortgageId,
      loanId: data.loanId,
      yearMonth: data.yearMonth,
      actualBalance: data.actualBalance,
      note: data.note,
      createdAt: new Date().toISOString(),
    };
    putDoc(mortgageBalanceSnapshot, childKey(mortgageId, entry.id), entry);
    return entry;
  });
}

export async function deleteBalanceSnapshot(mortgageId: string, snapshotId: string): Promise<boolean> {
  deleteRows(mortgageBalanceSnapshot, childKey(mortgageId, snapshotId));
  return true;
}

// ============================================================
// ACTUAL MONTHLY ENTRIES (imported bank history)
// ============================================================

function readActuals(mortgageId: string): MortgageActualEntry[] {
  return listDocs<MortgageActualEntry>(mortgageActual, childScope(mortgageId)).sort(
    (a, b) => a.yearMonth.localeCompare(b.yearMonth) || a.loanId.localeCompare(b.loanId)
  );
}

export async function getActuals(mortgageId: string): Promise<MortgageActualEntry[]> {
  return readActuals(mortgageId);
}

function upsertActual(mortgageId: string, input: MortgageActualInput): MortgageActualEntry {
  return inTx(() => {
    // Upsert by loanId + yearMonth
    const existing = readActuals(mortgageId).find(
      (a) => a.loanId === input.loanId && a.yearMonth === input.yearMonth
    );
    if (existing) {
      const updated: MortgageActualEntry = {
        ...existing,
        remaining: input.remaining,
        repayment: input.repayment,
        interest: input.interest,
        insurance: input.insurance,
        subsidy: input.subsidy ?? 0,
      };
      putDoc(mortgageActual, childKey(mortgageId, existing.id), updated);
      return updated;
    }
    const entry: MortgageActualEntry = {
      id: uuidv4(),
      mortgageId,
      loanId: input.loanId,
      yearMonth: input.yearMonth,
      remaining: input.remaining,
      repayment: input.repayment,
      interest: input.interest,
      insurance: input.insurance,
      subsidy: input.subsidy ?? 0,
      createdAt: new Date().toISOString(),
    };
    putDoc(mortgageActual, childKey(mortgageId, entry.id), entry);
    return entry;
  });
}

export async function setActual(
  mortgageId: string,
  input: MortgageActualInput
): Promise<MortgageActualEntry> {
  return upsertActual(mortgageId, input);
}

export async function deleteAllActuals(mortgageId: string): Promise<void> {
  deleteRows(mortgageActual, childScope(mortgageId));
}

/** Remove every recorded actual for one month (all loans). Used to "un-reconcile"
 * a month so it reverts to a projected forecast. Returns the number deleted. */
export async function deleteActualsForMonth(mortgageId: string, yearMonth: string): Promise<number> {
  return inTx(() => {
    const toDelete = readActuals(mortgageId).filter((a) => a.yearMonth === yearMonth);
    for (const a of toDelete) deleteRows(mortgageActual, childKey(mortgageId, a.id));
    return toDelete.length;
  });
}

/** Bulk import, in one transaction. When replaceAll is true, clears existing actuals first. */
export async function bulkSetActuals(
  mortgageId: string,
  inputs: MortgageActualInput[],
  replaceAll = false
): Promise<number> {
  inTx(() => {
    if (replaceAll) deleteRows(mortgageActual, childScope(mortgageId));
    for (const input of inputs) upsertActual(mortgageId, input);
  });
  return inputs.length;
}
