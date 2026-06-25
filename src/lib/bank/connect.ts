/**
 * Enable Banking — consent orchestration (server-only, shared by the server
 * action that starts a connection and the OAuth callback route that finishes it).
 *
 * Layer B (bank consent): PSD2 forbids silent renewal, so the user must complete
 * SCA. "begin" creates a pending connection + a single-use `state` and returns
 * the bank's auth URL; "complete" verifies that `state`, exchanges the code for a
 * session, maps accounts (re-using stable link ids across re-consent), and marks
 * the connection active. The live session_id is stored in a separate, uncached,
 * never-logged secret file.
 */

import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { updateTag } from 'next/cache';
import type { BankAccountLink, BankConnection } from '@/types';
import {
  createBankConnection,
  updateBankConnection,
  writeBankSessionSecret,
  findConnectionByState,
} from '@/lib/db/bank-connections';
import { startAuthorization, createSession } from './client';
import { mapSessionAccounts, type MappedBankAccount } from './mappers';
import { sessionResponseSchema } from '@/lib/schemas/bank.schema';
import { getBankConfig, CONSENT_REQUESTED_VALIDITY_DAYS } from './constants';
import { runSync } from './sync';

const MS_PER_DAY = 86_400_000;

function invalidate(userId: string, connectionId: string): void {
  updateTag(`user:${userId}:bank-connections`);
  updateTag(`user:${userId}:bank-connection:${connectionId}`);
  updateTag(`user:${userId}:accounts`);
}

/**
 * Begin a bank connection: create a pending BankConnection, mint a single-use
 * CSRF `state`, request authorization, and return the bank's SCA URL.
 */
export async function beginConnection(
  userId: string,
  aspspName: string,
  aspspCountry: string
): Promise<{ authUrl: string; connectionId: string }> {
  const config = getBankConfig();
  if (!config) throw new Error('Enable Banking is not configured');

  const connection = await createBankConnection(userId, {
    aspspName,
    aspspCountry,
    applicationId: config.appId,
    status: 'pending',
  });

  const state = crypto.randomBytes(32).toString('hex');
  const validUntilIso = new Date(
    Date.now() + CONSENT_REQUESTED_VALIDITY_DAYS * MS_PER_DAY
  ).toISOString();

  const { url, authorization_id } = await startAuthorization({
    aspspName,
    aspspCountry,
    state,
    redirectUrl: config.redirectUrl,
    validUntilIso,
    language: 'en',
  });

  await writeBankSessionSecret(userId, {
    connectionId: connection.id,
    state,
    authorizationId: authorization_id,
    createdAt: new Date().toISOString(),
  });

  invalidate(userId, connection.id);
  return { authUrl: url, connectionId: connection.id };
}

/** Merge freshly-mapped accounts with existing links, preserving stable ids
 * and any user configuration (role, linked account, card cycle) across re-consent. */
function reconcileLinks(
  existing: BankAccountLink[],
  mapped: MappedBankAccount[],
  connectionId: string
): BankAccountLink[] {
  return mapped.map((m) => {
    const prior = existing.find(
      (e) => e.accountUid === m.accountUid || (!!m.iban && e.iban === m.iban)
    );
    if (prior) {
      return {
        ...prior, // keep id, accountRole, linkedFinancialAccountId, card config, cursor
        connectionId,
        accountUid: m.accountUid,
        iban: m.iban ?? prior.iban,
        name: m.name ?? prior.name,
        currency: m.currency,
      };
    }
    return {
      id: uuidv4(),
      connectionId,
      accountUid: m.accountUid,
      iban: m.iban,
      name: m.name,
      currency: m.currency,
      accountRole: m.accountRole,
    };
  });
}

/**
 * Complete a bank connection from the callback: verify the single-use `state`
 * for this user, exchange the code for a session, map accounts, mark active.
 * Returns the connection, or null when the state doesn't match (CSRF / replay).
 */
export async function completeConnection(
  userId: string,
  code: string,
  state: string,
  psuIp?: string
): Promise<{ connection: BankConnection } | null> {
  const match = await findConnectionByState(userId, state);
  if (!match) return null; // unknown/replayed state — reject

  const { connection, secret } = match;

  const raw = await createSession(code);
  const parsed = sessionResponseSchema.safeParse(raw);
  if (!parsed.success) {
    await updateBankConnection(userId, connection.id, {
      status: 'error',
      lastError: 'BAD_RESPONSE',
    });
    invalidate(userId, connection.id);
    return { connection };
  }

  const sessionId = parsed.data.session_id;
  const mapped = mapSessionAccounts(raw);
  const linkedAccounts = reconcileLinks(connection.linkedAccounts, mapped, connection.id);

  const now = new Date().toISOString();
  const consentExpiresAt =
    parsed.data.access?.valid_until ??
    new Date(Date.now() + CONSENT_REQUESTED_VALIDITY_DAYS * MS_PER_DAY).toISOString();

  // Persist the live session_id and burn the single-use state (so the same
  // callback can't be replayed). Keep authorizationId for reference.
  await writeBankSessionSecret(userId, {
    connectionId: connection.id,
    state: crypto.randomBytes(16).toString('hex'), // rotate → old state no longer valid
    authorizationId: secret.authorizationId,
    sessionId,
    createdAt: secret.createdAt,
  });

  const updated = await updateBankConnection(userId, connection.id, {
    status: 'active',
    linkedAccounts,
    consentGrantedAt: now,
    consentExpiresAt,
    nextSyncDueAt: now, // sync as soon as possible (backfill runs next)
    lastError: undefined,
  });

  invalidate(userId, connection.id);

  // Run the ~60-day backfill synchronously within the callback request so the
  // user lands on settings with data already present. The PSU is right here, so
  // pass their IP for the higher rate allowance. A backfill failure must never
  // fail the consent itself — the scheduler/Refresh-now will retry.
  try {
    await runSync(userId, connection.id, 'callback-backfill', { psuIp });
  } catch (err) {
    console.error('[bank] backfill after consent failed:', err);
  }

  invalidate(userId, connection.id);
  return { connection: updated ?? connection };
}
