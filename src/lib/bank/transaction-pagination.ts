import type { BankTransaction } from '@/types';
import {
  BankApiError,
  getAccountTransactions,
  type PsuContext,
  type TransactionsQuery,
} from './client';
import { collapseRepeatedDeliveries } from './dedup';
import { mapTransactions } from './mappers';

const MAX_TRANSACTION_PAGES = 50;

function badPaginationResponse(): BankApiError {
  // Continuation keys and response bodies are bank-provided opaque data. Keep
  // them out of the error so default and verbose logging are both safe.
  return new BankApiError('BAD_RESPONSE', 'Invalid transaction pagination response');
}

function validatePageEnvelope(raw: unknown): {
  transactions: unknown[];
  continuation_key?: string | null;
} {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badPaginationResponse();
  }

  const envelope = raw as Record<string, unknown>;
  if (!Array.isArray(envelope.transactions)) {
    throw badPaginationResponse();
  }

  if (
    Object.prototype.hasOwnProperty.call(envelope, 'continuation_key') &&
    envelope.continuation_key !== null &&
    typeof envelope.continuation_key !== 'string'
  ) {
    throw badPaginationResponse();
  }

  return envelope as { transactions: unknown[]; continuation_key?: string | null };
}

/**
 * Fetch and map one complete Enable Banking transaction result set, one array
 * of mapped rows per response page.
 *
 * Results stay buffered until every page validates and the pagination chain
 * terminates. This lets callers safely discard an incomplete booked or pending
 * result without accidentally persisting its earlier pages. The page boundaries
 * are kept so `collapseRepeatedDeliveries` can tell a row the bank repeated
 * across pages (one delivery) from genuine repeats within one page.
 */
export async function fetchAllAccountTransactionPages(
  accountUid: string,
  query: TransactionsQuery,
  psu: PsuContext | undefined,
  linkedAccountId: string,
  nowIso: string,
  idFactory: () => string
): Promise<BankTransaction[][]> {
  const pages: BankTransaction[][] = [];
  const seenContinuationKeys = new Set<string>();
  let continuationKey = query.continuationKey;

  if (continuationKey) seenContinuationKeys.add(continuationKey);

  for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
    const raw = await getAccountTransactions(
      accountUid,
      { ...query, continuationKey },
      psu
    );
    const envelope = validatePageEnvelope(raw);
    const mapped = mapTransactions(envelope, linkedAccountId, nowIso, idFactory);
    pages.push(mapped.transactions);

    const nextKey = envelope.continuation_key ?? undefined;
    if (!nextKey) return pages;
    if (seenContinuationKeys.has(nextKey)) throw badPaginationResponse();

    seenContinuationKeys.add(nextKey);
    continuationKey = nextKey;
  }

  throw badPaginationResponse();
}

/**
 * Fetch one complete result set (see `fetchAllAccountTransactionPages`) as a
 * flat list, with a row the bank repeated across pages collapsed to one
 * delivery (`collapseRepeatedDeliveries`). Rows repeated within one page are
 * kept — those are genuine identical transactions.
 */
export async function fetchAllAccountTransactions(
  accountUid: string,
  query: TransactionsQuery,
  psu: PsuContext | undefined,
  linkedAccountId: string,
  nowIso: string,
  idFactory: () => string
): Promise<BankTransaction[]> {
  const pages = await fetchAllAccountTransactionPages(
    accountUid,
    query,
    psu,
    linkedAccountId,
    nowIso,
    idFactory
  );
  return collapseRepeatedDeliveries(pages).rows;
}
