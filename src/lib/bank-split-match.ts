import { differenceInCalendarDays } from 'date-fns';
import type { SplitDuplicateCandidate, SplitLinkCandidate } from '@/types';

export interface BankTxForMatch {
  id: string;
  linkedAccountId?: string;
  ownerUserId?: string;
  amount: number;
  currency: string;
  bookingDate: string;
  transactionDate?: string;
  counterpartyName?: string;
  remittanceInfo?: string;
  status?: 'booked' | 'pending' | 'other';
}

export interface BankSplitMatch {
  kind: 'linked' | 'heuristic' | 'recovered';
  expenseId: string;
  groupId: string;
  groupName: string;
  title: string;
  date: string;
  amountCents: number;
  currency: string;
  related?: BankSplitMatch[];
}

const HEURISTIC_DAY_TOLERANCE = 3;

function toDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00`);
}

function normalizeName(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Conservative merchant affinity for duplicate/recovery decisions. */
export function hasStrongMerchantMatch(a: string | undefined, b: string | undefined): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if ((right.length >= 5 && left.includes(right)) || (left.length >= 5 && right.includes(left))) return true;
  const leftTokens = new Set(left.split(' '));
  const generic = new Set(['berlin', 'payment', 'payments', 'card', 'shop', 'store', 'unknown', 'merchant']);
  const meaningful = right.split(' ').filter((token) => token.length >= 5 && !generic.has(token));
  return meaningful.length > 0 && meaningful.some((token) => leftTokens.has(token));
}

function toMatch(kind: BankSplitMatch['kind'], candidate: SplitLinkCandidate): BankSplitMatch {
  return {
    kind,
    expenseId: candidate.expenseId,
    groupId: candidate.groupId,
    groupName: candidate.groupName,
    title: candidate.title,
    date: candidate.date,
    amountCents: candidate.amountCents,
    currency: candidate.currency,
  };
}

function isRecoveredLink(tx: BankTxForMatch, candidate: SplitLinkCandidate, source?: BankTxForMatch): boolean {
  const link = candidate.bankLink;
  if (!link || link.txId === tx.id || !tx.linkedAccountId) return false;
  if (tx.status && tx.status !== 'booked') return false;
  if (source?.status && source.status !== 'pending') return false;
  if (tx.ownerUserId && link.ownerUserId !== tx.ownerUserId) return false;
  if (link.linkedAccountId !== tx.linkedAccountId || link.ownerUserId.length === 0) return false;
  if (candidate.currency !== tx.currency) return false;
  if (link.amount == null || Math.round(link.amount * 100) !== Math.round(tx.amount * 100)) return false;
  if (!hasStrongMerchantMatch(tx.counterpartyName, link.counterpartyName)) return false;
  return Math.abs(differenceInCalendarDays(
    toDate(tx.transactionDate ?? tx.bookingDate),
    toDate(candidate.date),
  )) <= HEURISTIC_DAY_TOLERANCE;
}

function setMatches(
  result: Map<string, BankSplitMatch>,
  txId: string,
  candidates: SplitLinkCandidate[],
  kind: BankSplitMatch['kind'],
): void {
  const matches = candidates.map((candidate) => toMatch(kind, candidate));
  const primary = matches[0];
  if (!primary) return;
  if (matches.length > 1) primary.related = matches.slice(1);
  result.set(txId, primary);
}

/** Explicit links are resolved first, then stale-link recovery, then heuristics. */
export function matchTransactionsToSplits(
  transactions: BankTxForMatch[],
  candidates: SplitLinkCandidate[],
): Map<string, BankSplitMatch> {
  const result = new Map<string, BankSplitMatch>();
  if (transactions.length === 0 || candidates.length === 0) return result;

  const candidatesByTxId = new Map<string, SplitLinkCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.bankLink) continue;
    const rows = candidatesByTxId.get(candidate.bankLink.txId) ?? [];
    rows.push(candidate);
    candidatesByTxId.set(candidate.bankLink.txId, rows);
  }

  const matchedTransactions = new Set<string>();
  const matchedExpenses = new Set<string>();

  // Pass 1: every exact link wins, regardless of candidate order.
  for (const transaction of transactions) {
    const exact = candidatesByTxId.get(transaction.id) ?? [];
    if (exact.length === 0) continue;
    setMatches(result, transaction.id, exact, 'linked');
    matchedTransactions.add(transaction.id);
    exact.forEach((candidate) => matchedExpenses.add(candidate.expenseId));
  }

  // Pass 2: recover links whose pending id was replaced by a booked id.
  for (const transaction of transactions) {
    if (matchedTransactions.has(transaction.id)) continue;
    const recovered = candidates.filter((candidate) => {
      const source = transactions.find((row) => row.id === candidate.bankLink?.txId);
      return isRecoveredLink(transaction, candidate, source);
    });
    if (recovered.length === 0) continue;
    setMatches(result, transaction.id, recovered, 'recovered');
    matchedTransactions.add(transaction.id);
    recovered.forEach((candidate) => matchedExpenses.add(candidate.expenseId));
  }

  // Pass 3: unlinked manual rows, exact cents and ±3 purchase-date days.
  const byAmount = new Map<string, SplitLinkCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.bankLink || matchedExpenses.has(candidate.expenseId)) continue;
    const key = `${candidate.currency}:${candidate.amountCents}`;
    byAmount.set(key, [...(byAmount.get(key) ?? []), candidate]);
  }
  const pairs: { transactionId: string; candidate: SplitLinkCandidate; distance: number; name: boolean }[] = [];
  for (const transaction of transactions) {
    if (matchedTransactions.has(transaction.id) || transaction.amount >= 0) continue;
    const key = `${transaction.currency}:${Math.round(Math.abs(transaction.amount) * 100)}`;
    const txDate = toDate(transaction.transactionDate ?? transaction.bookingDate);
    for (const candidate of byAmount.get(key) ?? []) {
      const distance = Math.abs(differenceInCalendarDays(txDate, toDate(candidate.date)));
      if (distance <= HEURISTIC_DAY_TOLERANCE) {
        pairs.push({ transactionId: transaction.id, candidate, distance, name: hasStrongMerchantMatch(transaction.counterpartyName, candidate.title) });
      }
    }
  }
  pairs.sort((a, b) => (a.name === b.name ? 0 : a.name ? -1 : 1) || a.distance - b.distance || b.candidate.date.localeCompare(a.candidate.date));
  for (const pair of pairs) {
    if (matchedTransactions.has(pair.transactionId) || matchedExpenses.has(pair.candidate.expenseId)) continue;
    setMatches(result, pair.transactionId, [pair.candidate], 'heuristic');
    matchedTransactions.add(pair.transactionId);
    matchedExpenses.add(pair.candidate.expenseId);
  }
  return result;
}

/** Non-consuming duplicate search used by the save warning and server guard. */
export function findSplitDuplicateCandidates(
  transaction: BankTxForMatch,
  candidates: SplitLinkCandidate[],
  groupId?: string,
): SplitDuplicateCandidate[] {
  if (transaction.amount >= 0) return [];
  const transactionCents = Math.round(Math.abs(transaction.amount) * 100);
  const transactionDate = toDate(transaction.transactionDate ?? transaction.bookingDate);
  return candidates
    .filter((candidate) => !groupId || candidate.groupId === groupId)
    .flatMap((candidate): SplitDuplicateCandidate[] => {
      const exactLink = candidate.bankLink?.txId === transaction.id;
      if (exactLink) {
        return [{
          expenseId: candidate.expenseId,
          groupId: candidate.groupId,
          groupName: candidate.groupName,
          title: candidate.title,
          date: candidate.date,
          amountCents: candidate.amountCents,
          currency: candidate.currency,
          kind: 'linked',
        }];
      }
      if (candidate.currency !== transaction.currency) return [];
      if (Math.abs(differenceInCalendarDays(transactionDate, toDate(candidate.date))) > HEURISTIC_DAY_TOLERANCE) return [];
      const amountDifference = Math.abs(candidate.amountCents - transactionCents);
      const exactAmount = amountDifference === 0;
      const recovered = isRecoveredLink(transaction, candidate);
      const strongName = hasStrongMerchantMatch(transaction.counterpartyName, candidate.bankLink?.counterpartyName ?? candidate.title);
      const nearAmount = amountDifference <= Math.max(100, Math.round(transactionCents * 0.02));
      if (!exactLink && !recovered && !exactAmount && !(nearAmount && strongName)) return [];
      return [{
        expenseId: candidate.expenseId,
        groupId: candidate.groupId,
        groupName: candidate.groupName,
        title: candidate.title,
        date: candidate.date,
        amountCents: candidate.amountCents,
        currency: candidate.currency,
        kind: exactLink ? 'linked' : recovered ? 'recovered' : 'heuristic',
      }];
    })
    .sort((a, b) => (a.kind === 'linked' ? -1 : b.kind === 'linked' ? 1 : 0) || Math.abs(a.amountCents - transactionCents) - Math.abs(b.amountCents - transactionCents));
}
