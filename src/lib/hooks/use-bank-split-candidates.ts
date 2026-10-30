'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { getMySplitLinkCandidates } from '@/lib/actions/split-groups';
import { upsertSplitCandidate } from '@/lib/bank-split-match';
import { txDisplayDate } from '@/lib/bank-utils';
import type { BankTransaction, SplitLinkCandidate } from '@/types';

interface LinkCandidates {
  server: SplitLinkCandidate[];
  confirmed: SplitLinkCandidate[];
}

/** An unlinked copy of an expense does not acknowledge a newly saved bank link. */
function acknowledgesSavedCandidate(server: SplitLinkCandidate, saved: SplitLinkCandidate): boolean {
  return server.expenseId === saved.expenseId
    && server.bankLink?.txId === saved.bankLink?.txId
    && server.bankLink?.linkedAccountId === saved.bankLink?.linkedAccountId
    && server.bankLink?.ownerUserId === saved.bankLink?.ownerUserId;
}

/** Keep acknowledged saves visible until a current server read echoes their bank link. */
export function useBankSplitCandidates() {
  const [links, setLinks] = useState<Record<string, LinkCandidates>>({});
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
      setLinks((previous) => linkId in previous
        ? previous
        : { ...previous, [linkId]: { server: [], confirmed: [] } });
      return;
    }
    const nextServer = server;
    setLinks((previous) => {
      // React can defer applying this update beyond a newer save or request.
      if (requestsRef.current.get(linkId) !== sequence) return previous;
      return {
        ...previous,
        [linkId]: {
          server: nextServer,
          confirmed: (previous[linkId]?.confirmed ?? []).filter((saved) =>
            !nextServer.some((candidate) => acknowledgesSavedCandidate(candidate, saved))),
        },
      };
    });
  }, []);

  const ensureCandidatesFor = useCallback((linkId: string, txs: BankTransaction[]): void => {
    if (ledgersRef.current.get(linkId) !== txs) void loadCandidatesFor(linkId, txs);
  }, [loadCandidatesFor]);

  const addConfirmedCandidate = useCallback((linkId: string, candidate: SplitLinkCandidate): void => {
    // A read started before this save cannot acknowledge it or replace its server snapshot.
    requestsRef.current.set(linkId, ++sequenceRef.current);
    setLinks((previous) => ({
      ...previous,
      [linkId]: {
        server: previous[linkId]?.server ?? [],
        confirmed: upsertSplitCandidate(previous[linkId]?.confirmed ?? [], candidate),
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
