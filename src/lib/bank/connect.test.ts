import { beforeEach, describe, expect, it, vi } from 'vitest';

// beginReconnect with every collaborator stubbed: starting a consent renewal
// must keep the still-valid live session so syncs keep working until the new
// consent actually completes.
const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  getSecret: vi.fn(),
  writeSecret: vi.fn(),
  updateConnection: vi.fn(),
  startAuthorization: vi.fn(),
  findConnectionByState: vi.fn(),
  createSession: vi.fn(),
  runSync: vi.fn(),
}));

vi.mock('next/cache', () => ({ updateTag: vi.fn() }));
vi.mock('@/lib/db/bank-connections', () => ({
  createBankConnection: vi.fn(),
  updateBankConnection: mocks.updateConnection,
  getBankConnectionById: mocks.getConnection,
  writeBankSessionSecret: mocks.writeSecret,
  getBankSessionSecret: mocks.getSecret,
  findConnectionByState: mocks.findConnectionByState,
}));
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  startAuthorization: mocks.startAuthorization,
  createSession: mocks.createSession,
}));
vi.mock('./aspsp-info', () => ({ findAspspInfo: vi.fn(async () => null) }));
vi.mock('./sync', () => ({ runSync: mocks.runSync }));
vi.mock('./constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./constants')>()),
  getBankConfig: () => ({ appId: 'app-1', redirectUrl: 'https://sampolio.example.com/api/bank/callback' }),
  isBankSyncVerbose: () => false,
}));

import { beginReconnect, completeConnection } from './connect';
import { BankApiError } from './client';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnection.mockResolvedValue({ id: 'conn-1', aspspName: 'Test Bank', aspspCountry: 'FI', linkedAccounts: [] });
  mocks.startAuthorization.mockResolvedValue({ url: 'https://bank.example.com/sca', authorization_id: 'auth-new' });
});

describe('beginReconnect', () => {
  it('keeps the live sessionId next to the new pending state', async () => {
    mocks.getSecret.mockResolvedValue({
      connectionId: 'conn-1',
      state: 'burned-state',
      authorizationId: 'auth-old',
      sessionId: 'session-live',
      createdAt: '2026-04-01T00:00:00.000Z',
    });

    const result = await beginReconnect('user-alex', 'conn-1');
    expect(result.authUrl).toBe('https://bank.example.com/sca');

    expect(mocks.writeSecret).toHaveBeenCalledTimes(1);
    const written = mocks.writeSecret.mock.calls[0][1];
    expect(written).toMatchObject({ connectionId: 'conn-1', authorizationId: 'auth-new', sessionId: 'session-live' });
    expect(written.state).not.toBe('burned-state');
    expect(written.state).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes no sessionId when there was no live session', async () => {
    mocks.getSecret.mockResolvedValue(null);
    await beginReconnect('user-alex', 'conn-1');
    const written = mocks.writeSecret.mock.calls[0][1];
    expect(written.sessionId).toBeUndefined();
    expect(written.authorizationId).toBe('auth-new');
  });
});


describe('completeConnection', () => {
  const connection = {
    id: 'conn-1', aspspName: 'Test Bank', status: 'active',
    linkedAccounts: [{ id: 'link-1', connectionId: 'conn-1', accountUid: 'old-uid', identificationHash: 'stable-hash', currency: 'EUR', accountRole: 'cash', customName: 'Everyday', syncCursor: { backfilledThrough: '2025-01-01', lastFetchedAt: '2026-01-01' } }],
  };
  const pendingSecret = { connectionId: 'conn-1', state: 'pending-state', authorizationId: 'auth-new', createdAt: '2026-04-01T00:00:00.000Z' };

  it('rejects a malformed first session, marks it failed, and does not write secrets or sync', async () => {
    mocks.findConnectionByState.mockResolvedValueOnce({ connection: { ...connection, status: 'pending', linkedAccounts: [] }, secret: pendingSecret });
    mocks.createSession.mockResolvedValueOnce({ session_id: '' });
    const result = completeConnection('user-alex', 'code', 'pending-state');
    await expect(result).rejects.toBeInstanceOf(BankApiError);
    await expect(result).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    expect(mocks.updateConnection).toHaveBeenCalledWith('user-alex', 'conn-1', { status: 'error', lastError: 'BAD_RESPONSE' });
    expect(mocks.writeSecret).not.toHaveBeenCalled();
    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it('rejects a malformed renewal without modifying the live connection, cursor, or secret', async () => {
    const secret = { ...pendingSecret, sessionId: 'live-session' };
    mocks.findConnectionByState.mockResolvedValueOnce({ connection, secret });
    mocks.createSession.mockResolvedValueOnce({ accounts: [] });
    const result = completeConnection('user-alex', 'code', 'pending-state');
    await expect(result).rejects.toBeInstanceOf(BankApiError);
    await expect(result).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    expect(mocks.updateConnection).not.toHaveBeenCalled();
    expect(mocks.writeSecret).not.toHaveBeenCalled();
    expect(mocks.runSync).not.toHaveBeenCalled();
    expect(connection.linkedAccounts[0].syncCursor.backfilledThrough).toBe('2025-01-01');
    expect(secret.sessionId).toBe('live-session');
  });

  it('completes a valid renewal, preserving the stable link and burning state', async () => {
    mocks.findConnectionByState.mockResolvedValueOnce({ connection, secret: { ...pendingSecret, sessionId: 'live-session' } });
    mocks.createSession.mockResolvedValueOnce({ session_id: 'new-session', accounts: [{ uid: 'new-uid', identification_hash: 'stable-hash', currency: 'EUR' }] });
    mocks.updateConnection.mockResolvedValueOnce({ ...connection, status: 'active' });
    await completeConnection('user-alex', 'code', 'pending-state', { psuIp: '203.0.113.7' });
    expect(mocks.writeSecret).toHaveBeenCalledWith('user-alex', expect.objectContaining({ sessionId: 'new-session', state: expect.stringMatching(/^[0-9a-f]{32}$/) }));
    expect(mocks.writeSecret.mock.calls[0][1].state).not.toBe('pending-state');
    expect(mocks.updateConnection).toHaveBeenCalledWith('user-alex', 'conn-1', expect.objectContaining({
      status: 'active', linkedAccounts: [expect.objectContaining({ id: 'link-1', accountUid: 'new-uid', customName: 'Everyday', syncCursor: expect.objectContaining({ backfilledThrough: undefined, lastFetchedAt: '2026-01-01' }) })],
    }));
    expect(mocks.runSync).toHaveBeenCalledWith('user-alex', 'conn-1', 'callback-backfill', { psuIp: '203.0.113.7', psuUserAgent: undefined });
  });

  it('retains an unresolved transaction reference warning after successful renewal', async () => {
    const markedConnection = { ...connection, lastError: 'TRANSACTION_REFERENCE_CHANGED' };
    mocks.findConnectionByState.mockResolvedValueOnce({ connection: markedConnection, secret: { ...pendingSecret, sessionId: 'live-session' } });
    mocks.createSession.mockResolvedValueOnce({ session_id: 'new-session', accounts: [] });
    mocks.updateConnection.mockResolvedValueOnce(markedConnection);
    await completeConnection('user-alex', 'code', 'pending-state');
    expect(mocks.updateConnection).toHaveBeenCalledWith('user-alex', 'conn-1', expect.objectContaining({
      status: 'active', lastError: 'TRANSACTION_REFERENCE_CHANGED',
    }));
  });

  it('rejects an unknown state before exchanging the code', async () => {
    mocks.findConnectionByState.mockResolvedValueOnce(null);
    await expect(completeConnection('user-alex', 'code', 'invalid')).resolves.toBeNull();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
