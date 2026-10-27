/**
 * Split group storage layer (Splitwise replacement).
 *
 * Like SharedMortgage, a split group is SHARED by a set of members and lives in
 * global, non-user-scoped tables; access control is enforced in the action
 * layer via the `members` list. A per-user reverse index maps userId → groupIds.
 *
 * Expenses are one row each (`split_expense`) keyed by group and id, with the
 * storage month (`yearMonth`, the former monthly chunk) and `seq` (position
 * within that month). A maintained summary holds running balances so the hot
 * paths never read the full history: add, edit, delete and occurrence
 * overwrites apply a delta; import/prune rebuild it. Every write commits the
 * rows and the summary in one transaction.
 *
 * Tables (`sqlite/schema/finance.ts`): `split_group` (group meta + members +
 * recurrence rules), `split_expense`, `split_group_summary` (running balances +
 * month index), `split_group_member_index` (userId → groupIds, `seq` = order).
 *
 * Money is INTEGER CENTS everywhere; netByUserId sums to 0 per row (see split-utils).
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  SplitGroup,
  SplitGroupMember,
  SplitGroupMemberRole,
  SplitGroupSummary,
  SplitExpense,
  SplitRecurrenceRule,
  CreateSplitGroupRequest,
  UpdateSplitGroupRequest,
} from '@/types';
import { assertChunkMonth, assertSafeId } from './encryption';
import {
  deleteRows,
  distinctValues,
  getDoc,
  inTx,
  listDocs,
  listRows,
  nextSeq,
  putDoc,
  replaceSeqDocs,
} from './sqlite/docs';
import { splitExpense, splitGroup, splitGroupMemberIndex, splitGroupSummary } from './sqlite/schema';
import { pruneOccurrencesAfter } from '@/lib/split-utils';

// ============================================================
// KEYS
// ============================================================

const groupKey = (groupId: string) => ({ id: assertSafeId(groupId, 'groupId') });
const expenseScope = (groupId: string) => ({ groupId: assertSafeId(groupId, 'groupId') });
const monthScope = (groupId: string, yearMonth: string) => ({
  ...expenseScope(groupId),
  yearMonth: assertChunkMonth(yearMonth),
});

const ymOf = (date: string): string => date.slice(0, 7);

function readGroup(groupId: string): SplitGroup | null {
  return getDoc<SplitGroup>(splitGroup, groupKey(groupId));
}

function writeGroup(group: SplitGroup): void {
  putDoc(splitGroup, groupKey(group.id), group);
}

// ============================================================
// REVERSE MEMBER INDEX
// ============================================================

function readGroupIds(userId: string): string[] {
  return listRows(splitGroupMemberIndex, { userId: assertSafeId(userId, 'userId') }, 'seq').map(
    (r) => r.keys.groupId as string,
  );
}

export async function getSplitGroupIdsForUser(userId: string): Promise<string[]> {
  return readGroupIds(userId);
}

function addUserToIndex(userId: string, groupId: string): void {
  const uid = assertSafeId(userId, 'userId');
  if (!readGroupIds(uid).includes(groupId)) {
    putDoc(splitGroupMemberIndex, { userId: uid, groupId, seq: nextSeq(splitGroupMemberIndex, { userId: uid }) });
  }
}

function removeUserFromIndex(userId: string, groupId: string): void {
  deleteRows(splitGroupMemberIndex, { userId: assertSafeId(userId, 'userId'), groupId });
}

// ============================================================
// GROUP CRUD
// ============================================================

export async function getSplitGroupById(groupId: string): Promise<SplitGroup | null> {
  return readGroup(groupId);
}

export async function getSplitGroupsForUser(userId: string): Promise<SplitGroup[]> {
  return readGroupIds(userId)
    .map((id) => readGroup(id))
    .filter((g): g is SplitGroup => g !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Create a split group. `resolvedMembers` must already be email→userId resolved
 * (done in the action layer); the creator is added as an 'owner'.
 */
export async function createSplitGroup(
  creator: { userId: string; email: string; name: string },
  data: CreateSplitGroupRequest,
  resolvedMembers: SplitGroupMember[],
): Promise<SplitGroup> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const creatorMember: SplitGroupMember = {
    userId: creator.userId,
    email: creator.email,
    name: creator.name,
    role: 'owner',
  };
  const members = [creatorMember, ...resolvedMembers.filter((m) => m.userId !== creator.userId)];

  const group: SplitGroup = {
    id,
    name: data.name,
    emoji: data.emoji,
    currency: data.currency,
    members,
    recurrenceRules: [],
    isArchived: false,
    createdBy: creator.userId,
    createdAt: now,
    updatedAt: now,
    updatedBy: creator.userId,
  };

  inTx(() => {
    writeGroup(group);
    writeSummary(id, emptySummary(id));
    for (const m of members) addUserToIndex(m.userId, id);
  });

  return group;
}

/** Read-modify-write the group doc in one transaction. */
function mutateGroup(groupId: string, next: (group: SplitGroup) => SplitGroup): SplitGroup | null {
  return inTx(() => {
    const group = readGroup(groupId);
    if (!group) return null;
    const updated = next(group);
    writeGroup(updated);
    return updated;
  });
}

export async function updateSplitGroup(
  groupId: string,
  updates: UpdateSplitGroupRequest,
  byUserId: string,
): Promise<SplitGroup | null> {
  return mutateGroup(groupId, (group) => ({
    ...group,
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy: byUserId,
  }));
}

export async function deleteSplitGroup(groupId: string): Promise<boolean> {
  inTx(() => {
    const group = readGroup(groupId);
    // Cascade: expenses + summary
    deleteRows(splitExpense, expenseScope(groupId));
    deleteRows(splitGroupSummary, { groupId: assertSafeId(groupId, 'groupId') });
    deleteRows(splitGroup, groupKey(groupId));
    if (group) {
      for (const m of group.members) removeUserFromIndex(m.userId, groupId);
    }
  });
  return true;
}

// ============================================================
// MEMBERS
// ============================================================

export async function addSplitGroupMember(groupId: string, member: SplitGroupMember): Promise<SplitGroup | null> {
  return inTx(() => {
    const group = readGroup(groupId);
    if (!group) return null;
    if (group.members.some((m) => m.userId === member.userId)) return group;
    const updated: SplitGroup = {
      ...group,
      members: [...group.members, member],
      updatedAt: new Date().toISOString(),
    };
    writeGroup(updated);
    addUserToIndex(member.userId, groupId);
    return updated;
  });
}

export async function removeSplitGroupMember(groupId: string, userId: string): Promise<SplitGroup | null> {
  return inTx(() => {
    const updated = mutateGroup(groupId, (group) => ({
      ...group,
      members: group.members.filter((m) => m.userId !== userId),
      updatedAt: new Date().toISOString(),
    }));
    if (updated) removeUserFromIndex(userId, groupId);
    return updated;
  });
}

export async function updateSplitGroupMemberRole(
  groupId: string,
  userId: string,
  role: SplitGroupMemberRole,
): Promise<SplitGroup | null> {
  return mutateGroup(groupId, (group) => ({
    ...group,
    members: group.members.map((m) => (m.userId === userId ? { ...m, role } : m)),
    updatedAt: new Date().toISOString(),
  }));
}

// ============================================================
// RECURRENCE RULES (embedded in the group doc)
// ============================================================

export async function addRecurrenceRule(groupId: string, rule: SplitRecurrenceRule): Promise<SplitGroup | null> {
  return mutateGroup(groupId, (group) => ({
    ...group,
    recurrenceRules: [...group.recurrenceRules, rule],
    updatedAt: new Date().toISOString(),
  }));
}

export async function updateRecurrenceRule(
  groupId: string,
  ruleId: string,
  updates: Partial<SplitRecurrenceRule>,
): Promise<SplitGroup | null> {
  return mutateGroup(groupId, (group) => ({
    ...group,
    recurrenceRules: group.recurrenceRules.map((r) =>
      r.id === ruleId ? { ...r, ...updates, id: r.id, updatedAt: new Date().toISOString() } : r,
    ),
    updatedAt: new Date().toISOString(),
  }));
}

export async function deleteRecurrenceRule(groupId: string, ruleId: string): Promise<SplitGroup | null> {
  return mutateGroup(groupId, (group) => ({
    ...group,
    recurrenceRules: group.recurrenceRules.filter((r) => r.id !== ruleId),
    updatedAt: new Date().toISOString(),
  }));
}

// ============================================================
// EXPENSES (rows grouped by storage month)
// ============================================================

function readMonths(groupId: string): string[] {
  return distinctValues(splitExpense, 'yearMonth', expenseScope(groupId));
}

function readMonth(groupId: string, yearMonth: string): SplitExpense[] {
  return listDocs<SplitExpense>(splitExpense, monthScope(groupId, yearMonth), 'seq');
}

/** Replace one storage month's rows (an empty list removes the month). */
function writeMonth(groupId: string, yearMonth: string, rows: SplitExpense[]): void {
  replaceSeqDocs(splitExpense, monthScope(groupId, yearMonth), rows, (r) => ({ id: assertSafeId(r.id) }));
}

export async function getExpenseMonths(groupId: string): Promise<string[]> {
  return readMonths(groupId);
}

export async function getExpensesForMonth(groupId: string, yearMonth: string): Promise<SplitExpense[]> {
  return readMonth(groupId, yearMonth);
}

/** Newest date first, then newest createdAt (sorts `rows` in place). */
export const sortExpenseRows = (rows: SplitExpense[]): SplitExpense[] =>
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)));

export async function getExpensesForMonths(groupId: string, months: string[]): Promise<SplitExpense[]> {
  return sortExpenseRows(months.flatMap((ym) => readMonth(groupId, ym)));
}

export async function getAllExpenses(groupId: string): Promise<SplitExpense[]> {
  return getExpensesForMonths(groupId, readMonths(groupId));
}

/** A row located inside its storage month (`rows` is that month's live read). */
export interface LocatedExpense {
  ym: string;
  rows: SplitExpense[];
  index: number;
}

function locate(groupId: string, id: string): LocatedExpense | null {
  const hit = listRows<SplitExpense>(splitExpense, { ...expenseScope(groupId), id: assertSafeId(id) })[0];
  if (!hit) return null;
  const ym = hit.keys.yearMonth as string;
  const rows = readMonth(groupId, ym);
  const index = rows.findIndex((r) => r.id === id);
  return index >= 0 ? { ym, rows, index } : null;
}

/** Find a row by id (an indexed lookup, wherever its month). */
export async function locateExpense(groupId: string, id: string): Promise<LocatedExpense | null> {
  return locate(groupId, id);
}

export async function getExpenseById(groupId: string, id: string): Promise<SplitExpense | null> {
  const loc = locate(groupId, id);
  return loc ? loc.rows[loc.index] : null;
}

/** Append a brand-new row (hot path); delta-updates the summary without reading other months. */
export async function addExpense(groupId: string, expense: SplitExpense): Promise<SplitExpense> {
  inTx(() => {
    const ym = ymOf(expense.date);
    putDoc(
      splitExpense,
      { ...monthScope(groupId, ym), id: assertSafeId(expense.id), seq: nextSeq(splitExpense, monthScope(groupId, ym)) },
      expense,
    );
    applySummaryDelta(groupId, null, expense);
  });
  return expense;
}

/**
 * Recurrence period (YYYY-MM) of a generated row: the date encoded in its
 * `occurrenceKey` (`<ruleId>:<YYYY-MM-DD>`, immutable even if the row is moved),
 * falling back to the row's own date.
 */
function occurrencePeriod(row: SplitExpense): string {
  const keyDate = row.occurrenceKey?.split(':').pop();
  return keyDate && /^\d{4}-\d{2}/.test(keyDate) ? keyDate.slice(0, 7) : ymOf(row.date);
}

/**
 * Upsert a recurrence-generated row by its `occurrenceKey` (idempotent re-run):
 * an existing occurrence is overwritten in place (preserving id/createdAt), a new
 * one is appended. Returns whether it was newly created.
 *
 * `onePerMonth` (monthly/yearly rules): skip — write nothing — when the month
 * already holds another row generated from the same rule. Rules anchored on the
 * 29th–31st used to drift to the 28th, so a stored cursor such as `2026-04-28`
 * would otherwise get a second April row (`2026-04-30`).
 */
export async function upsertExpenseByOccurrence(
  groupId: string,
  expense: SplitExpense,
  opts?: { onePerMonth?: boolean },
): Promise<{ expense: SplitExpense; created: boolean; skipped?: boolean }> {
  return inTx(() => {
    const ym = ymOf(expense.date);
    const rows = readMonth(groupId, ym);
    const idx = expense.occurrenceKey
      ? rows.findIndex((r) => r.occurrenceKey && r.occurrenceKey === expense.occurrenceKey)
      : -1;
    if (idx < 0 && opts?.onePerMonth && expense.generatedFromRuleId) {
      // Compare recurrence periods, not storage months: a generated row the user
      // moved into this month keeps its original occurrenceKey and must not
      // suppress this month's own occurrence.
      const period = occurrencePeriod(expense);
      const sibling = rows.find((r) => r.generatedFromRuleId === expense.generatedFromRuleId && occurrencePeriod(r) === period);
      if (sibling) return { expense: sibling, created: false, skipped: true };
    }
    if (idx >= 0) {
      const prev = rows[idx];
      expense.id = prev.id;
      expense.createdAt = prev.createdAt;
      rows[idx] = expense;
      writeMonth(groupId, ym, rows);
      // Overwrites happen on catch-up re-runs; rebuild rather than delta so a
      // summary that drifted for any reason is repaired (rare path).
      rebuild(groupId);
      return { expense, created: false };
    }
    rows.push(expense);
    writeMonth(groupId, ym, rows);
    applySummaryDelta(groupId, null, expense);
    return { expense, created: true };
  });
}

function replaceLocated(groupId: string, loc: LocatedExpense, next: SplitExpense): SplitExpense {
  return inTx(() => {
    const prev = loc.rows[loc.index];
    const newYm = ymOf(next.date);
    if (loc.ym === newYm) {
      loc.rows[loc.index] = next;
      writeMonth(groupId, loc.ym, loc.rows);
    } else {
      loc.rows.splice(loc.index, 1);
      writeMonth(groupId, loc.ym, loc.rows);
      const target = readMonth(groupId, newYm);
      target.push(next);
      writeMonth(groupId, newYm, target);
    }
    applySummaryDelta(groupId, prev, next);
    return next;
  });
}

/**
 * Replace an already-located row (reusing the month read by `locateExpense`, so
 * the caller must hold the group lock between the two). May move the row across
 * months. Delta-updates the summary.
 */
export async function replaceLocatedExpense(groupId: string, loc: LocatedExpense, next: SplitExpense): Promise<SplitExpense> {
  return replaceLocated(groupId, loc, next);
}

function deleteLocated(groupId: string, loc: LocatedExpense): SplitExpense {
  return inTx(() => {
    const [removed] = loc.rows.splice(loc.index, 1);
    writeMonth(groupId, loc.ym, loc.rows);
    applySummaryDelta(groupId, removed, null);
    return removed;
  });
}

/** Delete an already-located row (caller holds the group lock). Returns the removed row. */
export async function deleteLocatedExpense(groupId: string, loc: LocatedExpense): Promise<SplitExpense> {
  return deleteLocated(groupId, loc);
}

/** Replace a row by id; may move it across months. Delta-updates the summary. */
export async function updateExpense(
  groupId: string,
  id: string,
  next: SplitExpense,
): Promise<SplitExpense | null> {
  return inTx(() => {
    const loc = locate(groupId, id);
    if (!loc) return null;
    return replaceLocated(groupId, loc, next);
  });
}

/** Delete a row by id. Delta-updates the summary. */
export async function deleteExpense(groupId: string, id: string): Promise<boolean> {
  return inTx(() => {
    const loc = locate(groupId, id);
    if (!loc) return false;
    deleteLocated(groupId, loc);
    return true;
  });
}

/**
 * Delete generated occurrences of `ruleId` dated strictly after
 * `endDateInclusive` across every affected month. Rebuilds the summary once if
 * anything was removed; returns the number of rows removed.
 * CALLER MUST HOLD THE GROUP LOCK.
 */
export async function deleteGeneratedOccurrencesAfter(
  groupId: string,
  ruleId: string,
  endDateInclusive: string,
): Promise<number> {
  return inTx(() => {
    const cutoffMonth = endDateInclusive.slice(0, 7);
    const months = readMonths(groupId).filter((ym) => ym >= cutoffMonth);
    let removed = 0;
    for (const ym of months) {
      const rows = readMonth(groupId, ym);
      const kept = pruneOccurrencesAfter(rows, ruleId, endDateInclusive);
      if (kept.length < rows.length) {
        removed += rows.length - kept.length;
        writeMonth(groupId, ym, kept);
      }
    }
    if (removed > 0) rebuild(groupId);
    return removed;
  });
}

/** Bulk import: group rows by month, write each month once, then rebuild the summary once. */
export async function bulkImportExpenses(
  groupId: string,
  expenses: SplitExpense[],
  replaceAll: boolean,
): Promise<number> {
  inTx(() => {
    if (replaceAll) deleteRows(splitExpense, expenseScope(groupId));
    const byMonth = new Map<string, SplitExpense[]>();
    for (const e of expenses) {
      const ym = ymOf(e.date);
      const arr = byMonth.get(ym) ?? [];
      arr.push(e);
      byMonth.set(ym, arr);
    }
    for (const [ym, newRows] of byMonth) {
      const existing = replaceAll ? [] : readMonth(groupId, ym);
      writeMonth(groupId, ym, [...existing, ...newRows]);
    }
    rebuild(groupId);
  });
  return expenses.length;
}

// ============================================================
// SUMMARY (running balances)
// ============================================================

function emptySummary(groupId: string): SplitGroupSummary {
  return {
    groupId,
    netByUserId: {},
    expenseCount: 0,
    paymentCount: 0,
    monthsWithData: [],
    updatedAt: new Date().toISOString(),
  };
}

function readSummary(groupId: string): SplitGroupSummary | null {
  return getDoc<SplitGroupSummary>(splitGroupSummary, { groupId: assertSafeId(groupId, 'groupId') });
}

export async function getSplitGroupSummary(groupId: string): Promise<SplitGroupSummary> {
  return readSummary(groupId) ?? emptySummary(groupId);
}

function writeSummary(groupId: string, summary: SplitGroupSummary): void {
  putDoc(splitGroupSummary, { groupId: assertSafeId(groupId, 'groupId') }, summary);
}

/**
 * O(1) summary delta (no other months read): subtract `removed`'s contribution,
 * add `added`'s. Covers add (null, row), edit (old, new) and delete (row, null).
 * Falls back to a full {@link rebuildSummary} when the summary is missing or
 * when a delete removes the row that set `lastActivityAt` (the next-latest
 * createdAt can sit in any month). Zero nets are dropped (readers use `?? 0`).
 */
function applySummaryDelta(groupId: string, removed: SplitExpense | null, added: SplitExpense | null): void {
  const s = readSummary(groupId);
  const lostLatest =
    !!removed && removed.createdAt === s?.lastActivityAt && (!added || added.createdAt < removed.createdAt);
  if (!s || lostLatest) {
    rebuild(groupId);
    return;
  }
  const apply = (row: SplitExpense, sign: 1 | -1) => {
    for (const [uid, c] of Object.entries(row.netByUserId)) {
      const next = (s.netByUserId[uid] ?? 0) + sign * c;
      if (next === 0) delete s.netByUserId[uid];
      else s.netByUserId[uid] = next;
    }
    if (row.kind === 'expense') s.expenseCount += sign;
    else s.paymentCount += sign;
  };
  if (removed) apply(removed, -1);
  if (added) {
    apply(added, 1);
    if (!s.lastActivityAt || added.createdAt > s.lastActivityAt) s.lastActivityAt = added.createdAt;
  }
  s.monthsWithData = readMonths(groupId);
  s.updatedAt = new Date().toISOString();
  writeSummary(groupId, s);
}

function rebuild(groupId: string): SplitGroupSummary {
  const months = readMonths(groupId);
  const net: Record<string, number> = {};
  let expenseCount = 0;
  let paymentCount = 0;
  let lastActivityAt: string | undefined;
  for (const ym of months) {
    for (const r of readMonth(groupId, ym)) {
      for (const [uid, c] of Object.entries(r.netByUserId)) net[uid] = (net[uid] ?? 0) + c;
      if (r.kind === 'expense') expenseCount += 1;
      else paymentCount += 1;
      if (!lastActivityAt || r.createdAt > lastActivityAt) lastActivityAt = r.createdAt;
    }
  }
  const summary: SplitGroupSummary = {
    groupId,
    netByUserId: net,
    expenseCount,
    paymentCount,
    lastActivityAt,
    monthsWithData: months,
    updatedAt: new Date().toISOString(),
  };
  writeSummary(groupId, summary);
  return summary;
}

/** Full recompute from all rows (cold paths: import, occurrence pruning, repair). */
export async function rebuildSummary(groupId: string): Promise<SplitGroupSummary> {
  return inTx(() => rebuild(groupId));
}
