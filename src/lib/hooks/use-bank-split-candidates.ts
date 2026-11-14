'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { getMySplitLinkCandidates, getSplitExpenseExists } from '@/lib/actions/split-groups';
import { upsertSplitCandidate } from '@/lib/bank-split-match';
import { txDisplayDate } from '@/lib/bank-utils';
import type { BankTransaction, SplitLinkCandidate } from '@/types';

interface LinkCandidates {
  server: SplitLinkCandidate[];
  confirmed: SplitLinkCandidate[];
}

/** An unlinked copy of an expense does not acknowledge a newly saved bank link. */
function acknowledgesSavedCandidate(server: SplitLinkCandidate, saved: SplitLinkCandidate): boolean {
  return server.groupId === saved.groupId
    && server.expenseId === saved.expenseId
    && server.bankLink?.txId === saved.bankLink?.txId
    && server.bankLink?.linkedAccountId === saved.bankLink?.linkedAccountId
    && server.bankLink?.ownerUserId === saved.bankLink?.ownerUserId;
}

/** Keep acknowledged saves visible until a current server read echoes their bank link. */
export function useBankSplitCandidates() {
  const [links, setLinks] = useState<Record<string, LinkCandidates>>({});
  const confirmedRef = useRef(new Map<string, SplitLinkCandidate[]>());
  const requestsRef = useRef(new Map<string, number>());
  const sequenceRef = useRef(0);
  const ledgersRef = useRef(new Map<string, BankTransaction[]>());

  const loadCandidatesFor = useCallback(async (linkId: string, txs: BankTransaction[]): Promise<void> => {
    const sequence = ++sequenceRef.current;
    requestsRef.current.set(linkId, sequence);
    ledgersRef.current.set(linkId, txs);
    const months = [...new Set(txs.map((tx) => txDisplayDate(tx).slice(0, 7)))];
    let server: SplitLinkCandidate[] | null = months.length === 0 ? [] : null;
    if (server === null) {
      try {
        const response = await getMySplitLinkCandidates(months);
        if (response.success && response.data) server = response.data;
      } catch {
        // A failed refresh must not erase either previously read or saved candidates.
      }
    }
    if (requestsRef.current.get(linkId) !== sequence) return;
    if (server === null) {
      const confirmed = confirmedRef.current.get(linkId) ?? [];
      setLinks((previous) => {
        if (requestsRef.current.get(linkId) !== sequence) return previous;
        return { ...previous, [linkId]: { server: previous[linkId]?.server ?? [], confirmed } };
      });
      return;
    }
    const nextServer = server;
    const pins = confirmedRef.current.get(linkId) ?? [];
    // An omitted candidate is not proof of deletion: month windows may be
    // incomplete. Verify by id in uncached storage before releasing a pin.
    const missing = months.length === 0 ? [] : pins.filter((saved) =>
      !nextServer.some((candidate) => candidate.groupId === saved.groupId && candidate.expenseId === saved.expenseId));
    const deleted = new Set<SplitLinkCandidate>();
    await Promise.all(missing.map(async (saved) => {
      try {
        const result = await getSplitExpenseExists(saved.groupId, saved.expenseId);
        if (result.success && result.data === false) deleted.add(saved);
      } catch {
        // A failed point check cannot establish deletion.
      }
    }));
    if (requestsRef.current.get(linkId) !== sequence) return;
    const confirmed = pins.filter((saved) =>
      !deleted.has(saved) && !nextServer.some((candidate) => acknowledgesSavedCandidate(candidate, saved)));
    confirmedRef.current.set(linkId, confirmed);
    setLinks((previous) => {
      // React can defer applying this update beyond a newer save or request.
      if (requestsRef.current.get(linkId) !== sequence) return previous;
      return { ...previous, [linkId]: { server: nextServer, confirmed } };
    });
  }, []);

  const ensureCandidatesFor = useCallback((linkId: string, txs: BankTransaction[]): void => {
    if (ledgersRef.current.get(linkId) !== txs) void loadCandidatesFor(linkId, txs);
  }, [loadCandidatesFor]);

  const addConfirmedCandidate = useCallback((linkId: string, candidate: SplitLinkCandidate): void => {
    // A read started before this save cannot acknowledge it or replace its server snapshot.
    requestsRef.current.set(linkId, ++sequenceRef.current);
    const confirmed = upsertSplitCandidate(confirmedRef.current.get(linkId) ?? [], candidate);
    confirmedRef.current.set(linkId, confirmed);
    setLinks((previous) => ({
      ...previous,
      [linkId]: {
        server: previous[linkId]?.server ?? [],
        confirmed,
      },
    }));
  }, []);

  const candidatesByLink = useMemo(() => Object.fromEntries(
    Object.entries(links).map(([linkId, { server, confirmed }]) => [
      linkId,
      confirmed.reduce((candidates, saved) => upsertSplitCandidate(candidates, saved), server),
    ]),
  ), [links]);

  return { candidatesByLink, loadCandidatesFor, ensureCandidatesFor, addConfirmedCandidate };
}
