import type {
  SplitActivityEvent,
  SplitExpense,
  SplitGroupSummary,
  SplitMemberBalance,
} from '@/types';

/** True only while the saved-data revision captured before a read is current. */
export function isCurrentSplitRead(readRevision: number, currentRevision: number): boolean {
  return readRevision === currentRevision;
}

/** Merge an authoritative saved row, preserving one row per expense id. */
export function mergeSavedSplitExpense(
  rows: SplitExpense[],
  saved: SplitExpense,
): SplitExpense[] {
  return [saved, ...rows.filter((row) => row.id !== saved.id)].sort((a, b) =>
    a.date === b.date
      ? b.createdAt.localeCompare(a.createdAt)
      : b.date.localeCompare(a.date),
  );
}

/** Keep optimistic pins only until their storage month has been read again. */
export function reconcileSavedSplitRows(
  fetchedRows: SplitExpense[],
  pinnedRows: SplitExpense[],
  queriedMonths: string[],
): { rows: SplitExpense[]; remainingPins: SplitExpense[] } {
  const fetchedIds = new Set(fetchedRows.map((row) => row.id));
  const queried = new Set(queriedMonths);
  const remainingPins = pinnedRows.filter(
    (row) => !fetchedIds.has(row.id) && !queried.has(row.date.slice(0, 7)),
  );
  return {
    rows: remainingPins.reduce(mergeSavedSplitExpense, fetchedRows),
    remainingPins,
  };
}

/** Number of newest months to reveal so a saved row's storage month is loaded. */
export function visibleSplitMonthCount(
  monthsWithData: string[],
  savedMonth: string,
  currentCount: number,
): number {
  const months = [...new Set([...monthsWithData, savedMonth])].sort().reverse();
  return Math.max(currentCount, months.indexOf(savedMonth) + 1);
}

/** Apply an expense/payment delta to the displayed summary without a read. */
export function applySavedSplitSummary(
  summary: SplitGroupSummary,
  previous: SplitExpense | undefined,
  saved: SplitExpense,
): SplitGroupSummary {
  const netByUserId = { ...summary.netByUserId };
  for (const userId of new Set([
    ...Object.keys(previous?.netByUserId ?? {}),
    ...Object.keys(saved.netByUserId),
  ])) {
    netByUserId[userId] =
      (netByUserId[userId] ?? 0) - (previous?.netByUserId[userId] ?? 0) +
      (saved.netByUserId[userId] ?? 0);
    if (netByUserId[userId] === 0) delete netByUserId[userId];
  }

  const monthsWithData = [...new Set([...summary.monthsWithData, saved.date.slice(0, 7)])].sort();
  return {
    ...summary,
    netByUserId,
    expenseCount: summary.expenseCount +
      (saved.kind === 'expense' ? 1 : 0) -
      (previous?.kind === 'expense' ? 1 : 0),
    paymentCount: summary.paymentCount +
      (saved.kind === 'payment' ? 1 : 0) -
      (previous?.kind === 'payment' ? 1 : 0),
    lastActivityAt:
      !summary.lastActivityAt || saved.createdAt > summary.lastActivityAt
        ? saved.createdAt
        : summary.lastActivityAt,
    monthsWithData,
  };
}

/** Keep member balance cards aligned with the saved row before celebration. */
export function applySavedSplitBalances(
  balances: SplitMemberBalance[],
  previous: SplitExpense | undefined,
  saved: SplitExpense,
): SplitMemberBalance[] {
  return balances.map((balance) => ({
    ...balance,
    netCents:
      balance.netCents - (previous?.netByUserId[balance.userId] ?? 0) +
      (saved.netByUserId[balance.userId] ?? 0),
  }));
}

export function splitExpenseToActivityEvent(
  row: SplitExpense,
  group: { id: string; name: string; emoji?: string; members: { userId: string; name: string }[] },
  viewerId: string,
): SplitActivityEvent {
  const nameOf = (id: string) => group.members.find((member) => member.userId === id)?.name ?? 'Someone';
  return {
    id: row.id,
    groupId: group.id,
    groupName: group.name,
    groupEmoji: group.emoji,
    kind: row.kind,
    title: row.kind === 'payment'
      ? `${nameOf(row.fromUserId)} paid ${nameOf(row.toUserId)}`
      : row.title,
    category: row.kind === 'payment' ? 'Payment' : row.category,
    amountCents: row.amountCents,
    viewerNetCents: row.netByUserId[viewerId] ?? 0,
    actorUserId: row.createdByUserId,
    actorName: nameOf(row.createdByUserId),
    date: row.date,
    createdAt: row.createdAt,
    source: row.source,
  };
}

export function mergeSavedSplitActivity(
  events: SplitActivityEvent[] | null,
  saved: SplitActivityEvent,
): SplitActivityEvent[] {
  return [saved, ...(events ?? []).filter((event) => event.id !== saved.id)].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}
