import { beforeEach, describe, expect, it, vi } from 'vitest';

// refreshBankConnection's PSU context, with every collaborator stubbed: the
// action must pass the IP from `clientIpFrom` (cf-connecting-ip first), not
// the first X-Forwarded-For hop a client can set through the tunnel.
const mocks = vi.hoisted(() => ({
  headers: { current: new Headers() },
  auth: vi.fn(),
  getConnection: vi.fn(),
  runSync: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: async () => mocks.headers.current }));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/bank-connections', () => ({
  getBankConnectionById: mocks.getConnection,
  updateBankConnection: vi.fn(),
}));
vi.mock('@/lib/bank/sync', () => ({ runSync: mocks.runSync }));

import { refreshBankConnection } from './bank';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user-alex' } });
  mocks.getConnection.mockResolvedValue({ id: 'conn-1', lastSyncAt: undefined });
  mocks.runSync.mockResolvedValue({ id: 'run-1' });
});

describe('refreshBankConnection PSU context', () => {
  it('uses cf-connecting-ip, not a spoofed first X-Forwarded-For hop', async () => {
    mocks.headers.current = new Headers({
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '10.0.0.1, 203.0.113.7',
      'user-agent': UA,
    });
    const result = await refreshBankConnection('conn-1');
    expect(result.success).toBe(true);
    expect(mocks.runSync).toHaveBeenCalledWith('user-alex', 'conn-1', 'manual', { psuIp: '203.0.113.7', psuUserAgent: UA });
  });

  it('runs without a PSU IP when no header names the client', async () => {
    mocks.headers.current = new Headers({ 'user-agent': UA });
    expect((await refreshBankConnection('conn-1')).success).toBe(true);
    expect(mocks.runSync).toHaveBeenCalledWith('user-alex', 'conn-1', 'manual', { psuIp: undefined, psuUserAgent: UA });
  });
});
