/**
 * Split group storage layer (Splitwise replacement).
 *
 * Like SharedMortgage, a split group is SHARED by a set of members and lives in
 * a global, non-user-scoped directory; access control is enforced in the action
 * layer via the `members` list. A per-user reverse index maps userId → groupIds.
 *
 * Expenses are stored in MONTHLY CHUNK files (one array per YYYY-MM), not one
 * file per row — at ~2,500 rows/group the per-file PBKDF2 cost of one-file-per-row
 * would block the event loop on every cache miss. A maintained summary.enc holds
 * running balances so the hot paths never decrypt the full history: add, edit,
 * delete and occurrence overwrites apply a delta; import/prune rebuild it.
 *
 * Layout:
 *   data/shared/split-groups/{id}.enc                    # group meta + members + recurrence rules
 *   data/shared/split-groups/{id}/expenses/{YYYY-MM}.enc # array of that month's rows
 *   data/shared/split-groups/{id}/summary.enc            # running balances + month index
 *   data/shared/split-group-members/{userId}.enc         # { groupIds: string[] } reverse index
 *
 * Money is INTEGER CENTS everywhere; netByUserId sums to 0 per row (see split-utils).
 */

import * as path from 'path';
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
import {
  getDataDir,
  ensureDir,
  readEncryptedFile,
  writeEncryptedFile,
  listFiles,
  deleteFile,
  entityPath,
  entityDir,
  assertChunkMonth,
} from './encryption';
import { pruneOccurrencesAfter } from '@/lib/split-utils';

// ============================================================
// PATHS
// ============================================================

function getSharedDir(): string {
  return path.join(getDataDir(), 'shared');
}
function getGroupsDir(): string {
  return path.join(getSharedDir(), 'split-groups');
}
function getGroupFile(groupId: string): string {
  return entityPath(getGroupsDir(), groupId);
}
function getExpensesDir(groupId: string): string {
  return path.join(entityDir(getGroupsDir(), groupId), 'expenses');
}
function getChunkFile(groupId: string, yearMonth: string): string {
  return path.join(getExpensesDir(groupId), `${assertChunkMonth(yearMonth)}.enc`);
}
function getSummaryFile(groupId: string): string {
  return path.join(entityDir(getGroupsDir(), groupId), 'summary.enc');
}
function getMemberIndexFile(userId: string): string {
  return entityPath(path.join(getSharedDir(), 'split-group-members'), userId);
}

const ymOf = (date: string): string => date.slice(0, 7);

// ============================================================
// REVERSE MEMBER INDEX
// ============================================================

interface MemberIndex {
  groupIds: string[];
}

export async function getSplitGroupIdsForUser(userId: string): Promise<string[]> {
  const index = await readEncryptedFile<MemberIndex>(getMemberIndexFile(userId));
  return index?.groupIds ?? [];
}

async function addUserToIndex(userId: string, groupId: string): Promise<void> {
  const ids = await getSplitGroupIdsForUser(userId);
  if (!ids.includes(groupId)) {
    ids.push(groupId);
    await writeEncryptedFile(getMemberIndexFile(userId), { groupIds: ids });
  }
}

async function removeUserFromIndex(userId: string, groupId: string): Promise<void> {
  const ids = await getSplitGroupIdsForUser(userId);
  await writeEncryptedFile(getMemberIndexFile(userId), { groupIds: ids.filter((id) => id !== groupId) });
}

// ============================================================
// GROUP CRUD
// ============================================================

export async function getSplitGroupById(groupId: string): Promise<SplitGroup | null> {
  return readEncryptedFile<SplitGroup>(getGroupFile(groupId));
}

export async function getSplitGroupsForUser(userId: string): Promise<SplitGroup[]> {
  const ids = await getSplitGroupIdsForUser(userId);
  const results = await Promise.all(ids.map((id) => getSplitGroupById(id)));
  return results
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

  await ensureDir(getGroupsDir());
  await writeEncryptedFile(getGroupFile(id), group);
  await writeSummary(id, emptySummary(id));
  await Promise.all(members.map((m) => addUserToIndex(m.userId, id)));

  return group;
}

export async function updateSplitGroup(
  groupId: string,
  updates: UpdateSplitGroupRequest,
  byUserId: string,
): Promise<SplitGroup | null> {
  const group = await getSplitGroupById(groupId);
  if (!group) return null;
  const updated: SplitGroup = {
    ...group,
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy: byUserId,
  };
  await writeEncryptedFile(getGroupFile(groupId), updated);
  return updated;
}

export async function deleteSplitGroup(groupId: string): Promise<boolean> {
  const group = await getSplitGroupById(groupId);
  // Cascade: expense chunks + summary
  const expDir = getExpensesDir(groupId);
  try {
    const files = await listFiles(expDir);
    for (const f of files) await deleteFile(path.join(expDir, f));
  } catch {
    // dir may not exist
  }
  await deleteFile(getSummaryFile(groupId));
  await deleteFile(getGroupFile(groupId));
  if (group) {
    await Promise.all(group.members.map((m) => removeUserFromIndex(m.userId, groupId)));
  }
  return true;
}

// ============================================================
// MEMBERS
// ============================================================

export async function addSplitGroupMember(groupId: string, member: SplitGroupMember): Promise<SplitGroup | null> {
  const group = await getSplitGroupById(groupId);
  if (!group) return null;
  if (group.members.some((m) => m.userId === member.userId)) return group;
  const updated: SplitGroup = {
    ...group,
    members: [...group.members, member],
    updatedAt: new Date().toISOString(),
  };
  await writeEncryptedFile(getGroupFile(groupId), updated);
  await addUserToIndex(member.userId, groupId);
  return updated;
}

export async function removeSplitGroupMember(groupId: string, userId: string): Promise<SplitGroup | null> {
  const group = await getSplitGroupById(groupId);
  if (!group) return null;
  const updated: SplitGroup = {
    ...group,
    members: group.members.filter((m) => m.userId !== userId),
    updatedAt: new Date().toISOString(),
  };
  await writeEncryptedFile(getGroupFile(groupId), updated);
  await removeUserFromIndex(userId, groupId);
  return updated;
}

export async function updateSplitGroupMemberRole(
  groupId: string,
  userId: string,
  role: SplitGroupMemberRole,
): Promise<SplitGroup | null> {
  const group = await getSplitGroupById(groupId);
  if (!group) return null;
  const updated: SplitGroup = {
    ...group,
    members: group.members.map((m) => (m.userId === userId ? { ...m, role } : m)),
    updatedAt: new Date().toISOString(),
  };
  await writeEncryptedFile(getGroupFile(groupId), updated);
  return updated;
}

// ============================================================
// RECURRENCE RULES (embedded in the group doc)
// ============================================================

export async function addRecurrenceRule(groupId: string, rule: SplitRecurrenceRule): Promise<SplitGroup | null> {
  const group = await getSplitGroupById(groupId);
  if (!group) return null;
  const updated: SplitGroup = {
    ...group,
    recurrenceRules: [...group.recurrenceRules, rule],
    updatedAt: new Date().toISOString(),
  };
  await writeEncryptedFile(getGroupFile(groupId), updated);
  return updated;
}

export async function updateRecurrenceRule(
  groupId: string,
  ruleId: string,
  updates: Partial<SplitRecurrenceRule>,
): Promise<SplitGroup | null> {
  const group = await getSplitGroupById(groupId);
  if (!group) return null;
  const updated: SplitGroup = {
    ...group,
    recurrenceRules: group.recurrenceRules.map((r) =>
      r.id === ruleId ? { ...r, ...updates, id: r.id, updatedAt: new Date().toISOString() } : r,
    ),
    updatedAt: new Date().toISOString(),
  };
  await writeEncryptedFile(getGroupFile(groupId), updated);
  return updated;
}

export async function deleteRecurrenceRule(groupId: string, ruleId: string): Promise<SplitGroup | null> {
  const group = await getSplitGroupById(groupId);
  if (!group) return null;
  const updated: SplitGroup = {
    ...group,
    recurrenceRules: group.recurrenceRules.filter((r) => r.id !== ruleId),
    updatedAt: new Date().toISOString(),
  };
  await writeEncryptedFile(getGroupFile(groupId), updated);
  return updated;
}

// ============================================================
// EXPENSES (monthly chunks)
// ============================================================

export async function getExpenseMonths(groupId: string): Promise<string[]> {
  const files = await listFiles(getExpensesDir(groupId));
  return files
    .filter((f) => f.endsWith('.enc'))
    .map((f) => f.replace(/\.enc$/, ''))
    .sort();
}

export async function getExpensesForMonth(groupId: string, yearMonth: string): Promise<SplitExpense[]> {
  const rows = await readEncryptedFile<SplitExpense[]>(getChunkFile(groupId, yearMonth));
  return rows ?? [];
}

/** Newest date first, then newest createdAt (sorts `rows` in place). */
export const sortExpenseRows = (rows: SplitExpense[]): SplitExpense[] =>
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)));

export async function getExpensesForMonths(groupId: string, months: string[]): Promise<SplitExpense[]> {
  const chunks = await Promise.all(months.map((ym) => getExpensesForMonth(groupId, ym)));
  return sortExpenseRows(chunks.flat());
}

export async function getAllExpenses(groupId: string): Promise<SplitExpense[]> {
  const months = await getExpenseMonths(groupId);
  return getExpensesForMonths(groupId, months);
}

async function writeMonthChunk(groupId: string, yearMonth: string, rows: SplitExpense[]): Promise<void> {
  const file = getChunkFile(groupId, yearMonth);
  if (rows.length === 0) {
    await deleteFile(file);
  } else {
    await writeEncryptedFile(file, rows);
  }
}

/** A row located inside its month chunk (the chunk array is the live read). */
export interface LocatedExpense {
  ym: string;
  rows: SplitExpense[];
  index: number;
}

/**
 * Find a row by id. Scans the optional `monthHint` chunk first (callers usually
 * know the row's date), then every chunk NEWEST-first — edits and deletes almost
 * always target recent rows. Chunks are read one at a time so a hit stops early.
 */
export async function locateExpense(groupId: string, id: string, monthHint?: string): Promise<LocatedExpense | null> {
  const months = (await getExpenseMonths(groupId)).reverse();
  const hint = monthHint && months.includes(monthHint) ? monthHint : undefined;
  const order = hint ? [hint, ...months.filter((ym) => ym !== hint)] : months;
  for (const ym of order) {
    const rows = await getExpensesForMonth(groupId, ym);
    const index = rows.findIndex((r) => r.id === id);
    if (index >= 0) return { ym, rows, index };
  }
  return null;
}

export async function getExpenseById(groupId: string, id: string, monthHint?: string): Promise<SplitExpense | null> {
  const loc = await locateExpense(groupId, id, monthHint);
  return loc ? loc.rows[loc.index] : null;
}

/** Append a brand-new row (hot path); delta-updates the summary without reading other chunks. */
export async function addExpense(groupId: string, expense: SplitExpense): Promise<SplitExpense> {
  const ym = ymOf(expense.date);
  const rows = await getExpensesForMonth(groupId, ym);
  rows.push(expense);
  await writeMonthChunk(groupId, ym, rows);
  await applySummaryDelta(groupId, null, expense);
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
 * chunk already holds another row generated from the same rule. Rules anchored
 * on the 29th–31st used to drift to the 28th, so a stored cursor such as
 * `2026-04-28` would otherwise get a second April row (`2026-04-30`).
 */
export async function upsertExpenseByOccurrence(
  groupId: string,
  expense: SplitExpense,
  opts?: { onePerMonth?: boolean },
): Promise<{ expense: SplitExpense; created: boolean; skipped?: boolean }> {
  const ym = ymOf(expense.date);
  const rows = await getExpensesForMonth(groupId, ym);
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
    await writeMonthChunk(groupId, ym, rows);
    // Overwrites happen on catch-up re-runs, including a retry after a run was
    // interrupted between the chunk and summary writes — a delta would leave
    // that stale summary as is, so rebuild (rare path).
    await rebuildSummary(groupId);
    return { expense, created: false };
  }
  rows.push(expense);
  await writeMonthChunk(groupId, ym, rows);
  await applySummaryDelta(groupId, null, expense);
  return { expense, created: true };
}

/**
 * Replace an already-located row (reusing the chunk read by `locateExpense`, so
 * the caller must hold the group lock between the two). May move the row across
 * month chunks. Delta-updates the summary.
 */
export async function replaceLocatedExpense(groupId: string, loc: LocatedExpense, next: SplitExpense): Promise<SplitExpense> {
  const prev = loc.rows[loc.index];
  const newYm = ymOf(next.date);
  if (loc.ym === newYm) {
    loc.rows[loc.index] = next;
    await writeMonthChunk(groupId, loc.ym, loc.rows);
  } else {
    loc.rows.splice(loc.index, 1);
    await writeMonthChunk(groupId, loc.ym, loc.rows);
    const target = await getExpensesForMonth(groupId, newYm);
    target.push(next);
    await writeMonthChunk(groupId, newYm, target);
  }
  await applySummaryDelta(groupId, prev, next);
  return next;
}

/** Delete an already-located row (caller holds the group lock). Returns the removed row. */
export async function deleteLocatedExpense(groupId: string, loc: LocatedExpense): Promise<SplitExpense> {
  const [removed] = loc.rows.splice(loc.index, 1);
  await writeMonthChunk(groupId, loc.ym, loc.rows);
  await applySummaryDelta(groupId, removed, null);
  return removed;
}

/** Replace a row by id; may move it across month chunks. Delta-updates the summary. */
export async function updateExpense(
  groupId: string,
  id: string,
  next: SplitExpense,
  monthHint?: string,
): Promise<SplitExpense | null> {
  const loc = await locateExpense(groupId, id, monthHint);
  if (!loc) return null;
  return replaceLocatedExpense(groupId, loc, next);
}

/** Delete a row by id. Delta-updates the summary. */
export async function deleteExpense(groupId: string, id: string, monthHint?: string): Promise<boolean> {
  const loc = await locateExpense(groupId, id, monthHint);
  if (!loc) return false;
  await deleteLocatedExpense(groupId, loc);
  return true;
}

/**
 * Delete generated occurrences of `ruleId` dated strictly after
 * `endDateInclusive` across every affected month chunk. Rebuilds the summary
 * once if anything was removed; returns the number of rows removed.
 * CALLER MUST HOLD THE GROUP LOCK (reads-modifies-writes chunks + summary).
 */
export async function deleteGeneratedOccurrencesAfter(
  groupId: string,
  ruleId: string,
  endDateInclusive: string,
): Promise<number> {
  const cutoffMonth = endDateInclusive.slice(0, 7);
  const months = (await getExpenseMonths(groupId)).filter((ym) => ym >= cutoffMonth);
  let removed = 0;
  for (const ym of months) {
    const rows = await getExpensesForMonth(groupId, ym);
    const kept = pruneOccurrencesAfter(rows, ruleId, endDateInclusive);
    if (kept.length < rows.length) {
      removed += rows.length - kept.length;
      await writeMonthChunk(groupId, ym, kept); // writeMonthChunk deletes the file when kept is empty
    }
  }
  if (removed > 0) await rebuildSummary(groupId);
  return removed;
}

/** Bulk import: group rows by month, write ~1 file per month, then rebuild the summary once. */
export async function bulkImportExpenses(
  groupId: string,
  expenses: SplitExpense[],
  replaceAll: boolean,
): Promise<number> {
  if (replaceAll) {
    for (const ym of await getExpenseMonths(groupId)) await deleteFile(getChunkFile(groupId, ym));
  }
  const byMonth = new Map<string, SplitExpense[]>();
  for (const e of expenses) {
    const ym = ymOf(e.date);
    const arr = byMonth.get(ym) ?? [];
    arr.push(e);
    byMonth.set(ym, arr);
  }
  for (const [ym, newRows] of byMonth) {
    const existing = replaceAll ? [] : await getExpensesForMonth(groupId, ym);
    await writeMonthChunk(groupId, ym, [...existing, ...newRows]);
  }
  await rebuildSummary(groupId);
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

export async function getSplitGroupSummary(groupId: string): Promise<SplitGroupSummary> {
  const s = await readEncryptedFile<SplitGroupSummary>(getSummaryFile(groupId));
  return s ?? emptySummary(groupId);
}

async function writeSummary(groupId: string, summary: SplitGroupSummary): Promise<void> {
  await ensureDir(path.dirname(getSummaryFile(groupId)));
  await writeEncryptedFile(getSummaryFile(groupId), summary);
}

/**
 * O(1) summary delta (no other chunks read): subtract `removed`'s contribution,
 * add `added`'s. Covers add (null, row), edit (old, new) and delete (row, null).
 * Falls back to a full {@link rebuildSummary} when the summary file is missing
 * or when a delete removes the row that set `lastActivityAt` (the next-latest
 * createdAt can sit in any chunk). Zero nets are dropped (readers use `?? 0`).
 */
async function applySummaryDelta(
  groupId: string,
  removed: SplitExpense | null,
  added: SplitExpense | null,
): Promise<void> {
  const s = await readEncryptedFile<SplitGroupSummary>(getSummaryFile(groupId));
  const lostLatest =
    !!removed && removed.createdAt === s?.lastActivityAt && (!added || added.createdAt < removed.createdAt);
  if (!s || lostLatest) {
    await rebuildSummary(groupId);
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
  s.monthsWithData = await getExpenseMonths(groupId); // cheap: filenames, no decrypt
  s.updatedAt = new Date().toISOString();
  await writeSummary(groupId, s);
}

/** Full recompute from all chunks (cold paths: import, occurrence pruning, repair). */
export async function rebuildSummary(groupId: string): Promise<SplitGroupSummary> {
  const months = await getExpenseMonths(groupId);
  const net: Record<string, number> = {};
  let expenseCount = 0;
  let paymentCount = 0;
  let lastActivityAt: string | undefined;
  for (const ym of months) {
    const rows = await getExpensesForMonth(groupId, ym);
    for (const r of rows) {
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
  await writeSummary(groupId, summary);
  return summary;
}
