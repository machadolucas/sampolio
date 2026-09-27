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
}));

vi.mock('next/cache', () => ({ updateTag: vi.fn() }));
vi.mock('@/lib/db/bank-connections', () => ({
  createBankConnection: vi.fn(),
  updateBankConnection: mocks.updateConnection,
  getBankConnectionById: mocks.getConnection,
  writeBankSessionSecret: mocks.writeSecret,
  getBankSessionSecret: mocks.getSecret,
  findConnectionByState: vi.fn(),
}));
vi.mock('./client', () => ({
  startAuthorization: mocks.startAuthorization,
  createSession: vi.fn(),
  BankApiError: class BankApiError extends Error {},
}));
vi.mock('./aspsp-info', () => ({ findAspspInfo: vi.fn(async () => null) }));
vi.mock('./sync', () => ({ runSync: vi.fn() }));
vi.mock('./constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./constants')>()),
  getBankConfig: () => ({ appId: 'app-1', redirectUrl: 'https://sampolio.example.com/api/bank/callback' }),
  isBankSyncVerbose: () => false,
}));

import { beginReconnect } from './connect';

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
