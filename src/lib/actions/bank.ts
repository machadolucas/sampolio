'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { updateTag } from 'next/cache';
import { auth } from '@/lib/auth';
import type {
  ApiResponse,
  BankConnection,
  BankSyncRun,
  BankTransaction,
  FinancialAccount,
} from '@/types';
import {
  getBankConnectionById as dbGetConnection,
  updateBankConnection as dbUpdateConnection,
  deleteBankConnection as dbDeleteConnection,
  getBankSessionSecret,
} from '@/lib/db/bank-connections';
import { deleteBankTransactionsForAccount } from '@/lib/db/bank-transactions';
import { deleteBankSyncRuns } from '@/lib/db/bank-sync-runs';
import { getAccountById as dbGetAccount, updateAccount as dbUpdateAccount } from '@/lib/db/accounts';
import {
  cachedGetBankConnections,
  cachedGetBankConnectionById,
  cachedGetBankSyncRuns,
  cachedGetBankTransactions,
} from '@/lib/db/cached';
import { beginConnection } from '@/lib/bank/connect';
import { runSync } from '@/lib/bank/sync';
import { deleteSession, getAspsps, redactBankError } from '@/lib/bank/client';
import { mapAspsps } from '@/lib/bank/mappers';
import { computeCardBilling } from '@/lib/bank/card-billing';
import { isBankFeatureConfigured, MIN_MANUAL_REFRESH_INTERVAL_MS } from '@/lib/bank/constants';
import { getConsentExpiryInfo } from '@/lib/bank-utils';
import {
  startBankConnectionSchema,
  updateBankAccountLinkSchema,
} from '@/lib/schemas/bank.schema';

/** Whether the Enable Banking feature has its secrets configured (else hidden). */
export async function getBankFeatureStatus(): Promise<ApiResponse<{ configured: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  return { success: true, data: { configured: isBankFeatureConfigured() } };
}

export async function getBankConnections(): Promise<ApiResponse<BankConnection[]>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const connections = await cachedGetBankConnections(session.user.id);
    return { success: true, data: connections };
  } catch (error) {
    console.error('Get bank connections error:', error);
    return { success: false, error: 'Failed to fetch bank connections' };
  }
}

/** List the banks (ASPSPs) Enable Banking offers for a country, for the picker. */
export async function listBankAspsps(
  country = 'FI'
): Promise<ApiResponse<{ name: string; country: string }[]>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!isBankFeatureConfigured()) {
      return { success: false, error: 'Bank sync is not configured on this server' };
    }
    const raw = await getAspsps(country);
    return { success: true, data: mapAspsps(raw) };
  } catch (error) {
    console.error('List ASPSPs error:', redactBankError(error));
    return { success: false, error: 'Could not load the list of banks' };
  }
}

/** Start a connection: returns the bank's SCA URL for the browser to redirect to. */
export async function startBankConnection(
  input: z.infer<typeof startBankConnectionSchema>
): Promise<ApiResponse<{ authUrl: string }>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!isBankFeatureConfigured()) {
      return { success: false, error: 'Bank sync is not configured on this server' };
    }
    const parsed = startBankConnectionSchema.parse(input);
    const { authUrl } = await beginConnection(session.user.id, parsed.aspspName, parsed.aspspCountry);
    return { success: true, data: { authUrl } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? 'Validation error' };
    }
    console.error('Start bank connection error:', redactBankError(error));
    return { success: false, error: 'Could not start the bank connection' };
  }
}

async function getPsuIp(): Promise<string | undefined> {
  try {
    const h = await headers();
    const fwd = h.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    return h.get('x-real-ip') ?? undefined;
  } catch {
    return undefined;
  }
}

/** On-demand "Refresh now". PSU is present, so we pass their IP (higher allowance). */
export async function refreshBankConnection(
  connectionId: string
): Promise<ApiResponse<BankSyncRun>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const connection = await dbGetConnection(session.user.id, connectionId);
    if (!connection) return { success: false, error: 'Connection not found' };

    if (connection.lastSyncAt) {
      const sinceMs = Date.now() - new Date(connection.lastSyncAt).getTime();
      if (sinceMs < MIN_MANUAL_REFRESH_INTERVAL_MS) {
        return { success: false, error: 'Just refreshed — please wait a few minutes before retrying' };
      }
    }

    const psuIp = await getPsuIp();
    const run = await runSync(session.user.id, connectionId, 'manual', { psuIp });
    return { success: true, data: run };
  } catch (error) {
    console.error('Refresh bank connection error:', redactBankError(error));
    return { success: false, error: 'Refresh failed' };
  }
}

/** Disconnect: best-effort revoke at the bank, then delete all local bank data. */
export async function disconnectBankConnection(
  connectionId: string
): Promise<ApiResponse<null>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const connection = await dbGetConnection(session.user.id, connectionId);
    if (!connection) return { success: false, error: 'Connection not found' };

    const secret = await getBankSessionSecret(session.user.id, connectionId);
    if (secret?.sessionId) {
      try {
        await deleteSession(secret.sessionId);
      } catch (err) {
        console.error('[bank] session revoke failed (continuing):', redactBankError(err));
      }
    }

    for (const link of connection.linkedAccounts) {
      await deleteBankTransactionsForAccount(session.user.id, link.id);
    }
    await deleteBankSyncRuns(session.user.id, connectionId);
    await dbDeleteConnection(session.user.id, connectionId);

    updateTag(`user:${session.user.id}:bank-connections`);
    updateTag(`user:${session.user.id}:bank-connection:${connectionId}`);
    return { success: true };
  } catch (error) {
    console.error('Disconnect bank connection error:', redactBankError(error));
    return { success: false, error: 'Disconnect failed' };
  }
}

/** Edit how a real bank account is used (role, linked account, card cycle, exclude). */
export async function updateBankAccountLink(
  connectionId: string,
  linkId: string,
  data: z.infer<typeof updateBankAccountLinkSchema>
): Promise<ApiResponse<BankConnection>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const parsed = updateBankAccountLinkSchema.parse(data);

    const connection = await dbGetConnection(session.user.id, connectionId);
    if (!connection) return { success: false, error: 'Connection not found' };
    const idx = connection.linkedAccounts.findIndex((l) => l.id === linkId);
    if (idx < 0) return { success: false, error: 'Account link not found' };

    const link = connection.linkedAccounts[idx];
    const next = { ...link };
    if (parsed.accountRole !== undefined) next.accountRole = parsed.accountRole;
    if (parsed.linkedFinancialAccountId !== undefined)
      next.linkedFinancialAccountId = parsed.linkedFinancialAccountId ?? undefined;
    if (parsed.isExcluded !== undefined) next.isExcluded = parsed.isExcluded;
    if (parsed.statementDay !== undefined) next.statementDay = parsed.statementDay ?? undefined;
    if (parsed.paymentDueDay !== undefined) next.paymentDueDay = parsed.paymentDueDay ?? undefined;
    if (parsed.creditLimit !== undefined) next.creditLimit = parsed.creditLimit ?? undefined;
    if (parsed.includeOpenCycleEstimate !== undefined)
      next.includeOpenCycleEstimate = parsed.includeOpenCycleEstimate;

    connection.linkedAccounts[idx] = next;
    const updated = await dbUpdateConnection(session.user.id, connectionId, {
      linkedAccounts: connection.linkedAccounts,
    });

    // Mark the linked cash/savings account as bank-synced so its UI reflects it.
    if (
      next.linkedFinancialAccountId &&
      (next.accountRole === 'cash' || next.accountRole === 'savings')
    ) {
      const acct = await dbGetAccount(session.user.id, next.linkedFinancialAccountId);
      if (acct && !acct.bankSyncEnabled) {
        await dbUpdateAccount(session.user.id, next.linkedFinancialAccountId, {
          bankSyncEnabled: true,
        } as Partial<FinancialAccount>);
        updateTag(`user:${session.user.id}:accounts`);
      }
    }

    updateTag(`user:${session.user.id}:bank-connections`);
    updateTag(`user:${session.user.id}:bank-connection:${connectionId}`);
    return updated
      ? { success: true, data: updated }
      : { success: false, error: 'Update failed' };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? 'Validation error' };
    }
    console.error('Update bank account link error:', error);
    return { success: false, error: 'Failed to update account link' };
  }
}

export interface ConnectionAttention {
  connectionId: string;
  aspspName: string;
  expired: boolean;
  expiringSoon: boolean;
  daysUntilExpiry: number | null;
}

/** Connections that need the user's attention (for the Overview reconnect banner). */
export async function getBankConnectionsNeedingAttention(): Promise<
  ApiResponse<ConnectionAttention[]>
> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const connections = await cachedGetBankConnections(session.user.id);
    const attention = connections
      .map((c) => {
        const info = getConsentExpiryInfo(c);
        return {
          connectionId: c.id,
          aspspName: c.aspspName,
          expired: info.expired,
          expiringSoon: info.expiringSoon,
          daysUntilExpiry: info.daysUntilExpiry,
        };
      })
      .filter((c) => c.expired || c.expiringSoon);
    return { success: true, data: attention };
  } catch (error) {
    console.error('Get bank attention error:', error);
    return { success: false, error: 'Failed to check bank connections' };
  }
}

export interface CardLiability {
  linkId: string;
  name: string;
  outstanding: number;
  billYearMonth?: string;
}

/** Current credit-card outstandings for the net-worth liability band. */
export async function getCardLiabilities(): Promise<ApiResponse<CardLiability[]>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const userId = session.user.id;
    const connections = await cachedGetBankConnections(userId);
    const out: CardLiability[] = [];
    for (const conn of connections) {
      for (const link of conn.linkedAccounts) {
        if (link.accountRole !== 'credit-card' || link.isExcluded) continue;
        const txs = await cachedGetBankTransactions(userId, link.id);
        const result = computeCardBilling({
          statementDay: link.statementDay,
          paymentDueDay: link.paymentDueDay,
          outstanding: link.outstanding,
          lastStatementBalance: link.lastStatementBalance,
          transactions: txs.map((t) => ({ bookingDate: t.bookingDate, amount: t.amount })),
          includeOpenCycleEstimate: link.includeOpenCycleEstimate,
        });
        if (result.outstanding > 0.005) {
          out.push({
            linkId: link.id,
            name: link.name ?? `${conn.aspspName} card`,
            outstanding: result.outstanding,
            billYearMonth: result.currentBillYearMonth,
          });
        }
      }
    }
    return { success: true, data: out };
  } catch (error) {
    console.error('Get card liabilities error:', error);
    return { success: false, error: 'Failed to compute card liabilities' };
  }
}

export async function getBankSyncRuns(
  connectionId: string
): Promise<ApiResponse<BankSyncRun[]>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const runs = await cachedGetBankSyncRuns(session.user.id, connectionId);
    return { success: true, data: runs };
  } catch (error) {
    console.error('Get bank sync runs error:', error);
    return { success: false, error: 'Failed to fetch sync runs' };
  }
}

/** Read-only transaction ledger for one linked account (verifies ownership). */
export async function getBankTransactionsForLink(
  linkId: string
): Promise<ApiResponse<BankTransaction[]>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const connections = await cachedGetBankConnections(session.user.id);
    const owns = connections.some((c) => c.linkedAccounts.some((l) => l.id === linkId));
    if (!owns) return { success: false, error: 'Account not found' };
    const txs = await cachedGetBankTransactions(session.user.id, linkId);
    return { success: true, data: txs };
  } catch (error) {
    console.error('Get bank transactions error:', error);
    return { success: false, error: 'Failed to fetch transactions' };
  }
}

// Keep this reference so cachedGetBankConnectionById is exercised by a typed
// accessor for detail views without widening the public surface unnecessarily.
export async function getBankConnection(
  connectionId: string
): Promise<ApiResponse<BankConnection>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const connection = await cachedGetBankConnectionById(session.user.id, connectionId);
    return connection
      ? { success: true, data: connection }
      : { success: false, error: 'Connection not found' };
  } catch (error) {
    console.error('Get bank connection error:', error);
    return { success: false, error: 'Failed to fetch connection' };
  }
}
