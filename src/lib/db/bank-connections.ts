/**
 * Enable Banking — connection storage.
 *
 * A BankConnection (one bank consent + its linked accounts) is stored
 * per-user, one row per connection (`bank_connection`). The live consent
 * secrets live in a SEPARATE table (`bank_session_secret`) that is NEVER
 * cached and never logged — only the action/sync layers read it, by an
 * uncached accessor.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  BankConnection,
  BankAccountLink,
  BankConnectionStatus,
  BankSessionSecret,
} from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, putDoc } from './sqlite/docs';
import { bankConnection, bankSessionSecret } from './sqlite/schema';

const connectionKey = (userId: string, connectionId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  id: assertSafeId(connectionId),
});
const secretKey = (userId: string, connectionId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  connectionId: assertSafeId(connectionId, 'connectionId'),
});

// ============================================================
// Connections
// ============================================================

function readConnections(userId: string): BankConnection[] {
  return listDocs<BankConnection>(bankConnection, { userId: assertSafeId(userId, 'userId') }).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

export async function getBankConnections(userId: string): Promise<BankConnection[]> {
  return readConnections(userId);
}

export async function getBankConnectionById(
  userId: string,
  connectionId: string
): Promise<BankConnection | null> {
  return getDoc<BankConnection>(bankConnection, connectionKey(userId, connectionId));
}

export async function createBankConnection(
  userId: string,
  data: {
    aspspName: string;
    aspspCountry: string;
    applicationId?: string;
    status?: BankConnectionStatus;
  }
): Promise<BankConnection> {
  const now = new Date().toISOString();
  const connection: BankConnection = {
    id: uuidv4(),
    userId,
    aspspName: data.aspspName,
    aspspCountry: data.aspspCountry,
    applicationId: data.applicationId,
    status: data.status ?? 'pending',
    psuType: 'personal',
    linkedAccounts: [],
    createdAt: now,
    updatedAt: now,
  };
  putDoc(bankConnection, connectionKey(userId, connection.id), connection);
  return connection;
}

export async function updateBankConnection(
  userId: string,
  connectionId: string,
  updates: Partial<Omit<BankConnection, 'id' | 'userId' | 'createdAt'>>
): Promise<BankConnection | null> {
  return inTx(() => {
    const existing = getDoc<BankConnection>(bankConnection, connectionKey(userId, connectionId));
    if (!existing) return null;
    const updated: BankConnection = {
      ...existing,
      ...updates,
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    putDoc(bankConnection, connectionKey(userId, connectionId), updated);
    return updated;
  });
}

/** Replace the full linked-account list (used after mapping accounts at consent). */
export async function setConnectionLinkedAccounts(
  userId: string,
  connectionId: string,
  linkedAccounts: BankAccountLink[]
): Promise<BankConnection | null> {
  return updateBankConnection(userId, connectionId, { linkedAccounts });
}

export async function deleteBankConnection(
  userId: string,
  connectionId: string
): Promise<boolean> {
  inTx(() => {
    deleteRows(bankConnection, connectionKey(userId, connectionId));
    deleteRows(bankSessionSecret, secretKey(userId, connectionId));
  });
  return true;
}

// ============================================================
// Session secret — UNCACHED, never logged
// ============================================================

function readSessionSecret(userId: string, connectionId: string): BankSessionSecret | null {
  return getDoc<BankSessionSecret>(bankSessionSecret, secretKey(userId, connectionId));
}

/** Read the live consent secrets for a connection. Intentionally not cached. */
export async function getBankSessionSecret(
  userId: string,
  connectionId: string
): Promise<BankSessionSecret | null> {
  return readSessionSecret(userId, connectionId);
}

export async function writeBankSessionSecret(
  userId: string,
  secret: BankSessionSecret
): Promise<void> {
  putDoc(bankSessionSecret, secretKey(userId, secret.connectionId), secret);
}

export async function deleteBankSessionSecret(
  userId: string,
  connectionId: string
): Promise<void> {
  deleteRows(bankSessionSecret, secretKey(userId, connectionId));
}

/**
 * Find the pending connection for a user whose session secret carries the given
 * single-use `state`. Used by the OAuth callback for CSRF matching. Returns the
 * connection + its secret, or null when no match (or already consumed).
 */
export async function findConnectionByState(
  userId: string,
  state: string
): Promise<{ connection: BankConnection; secret: BankSessionSecret } | null> {
  for (const connection of readConnections(userId)) {
    const secret = readSessionSecret(userId, connection.id);
    if (secret && secret.state === state) {
      return { connection, secret };
    }
  }
  return null;
}
