import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  completeConnection: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/bank/connect', () => ({ completeConnection: mocks.completeConnection }));

import { GET } from './route';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';

function callback(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://127.0.0.1:3999/api/bank/callback?code=abc&state=xyz', { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_URL', 'https://sampolio.example.com');
  mocks.auth.mockResolvedValue({ user: { id: 'user-alex' } });
  mocks.completeConnection.mockResolvedValue({ connection: { aspspName: 'Example Bank' } });
});

describe('bank callback PSU context', () => {
  it('sends cf-connecting-ip as the PSU IP, not the client-controlled first X-Forwarded-For hop', async () => {
    const response = await GET(
      callback({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1, 203.0.113.7', 'user-agent': UA }),
    );
    expect(response.headers.get('location')).toBe('https://sampolio.example.com/settings?bankConnected=Example%20Bank');
    expect(mocks.completeConnection).toHaveBeenCalledWith('user-alex', 'abc', 'xyz', {
      psuIp: '203.0.113.7',
      psuUserAgent: UA,
    });
  });

  it('falls back to the X-Forwarded-For first hop on the LAN path', async () => {
    await GET(callback({ 'x-forwarded-for': '192.168.1.50', 'user-agent': UA }));
    expect(mocks.completeConnection).toHaveBeenCalledWith('user-alex', 'abc', 'xyz', {
      psuIp: '192.168.1.50',
      psuUserAgent: UA,
    });
  });

  it('still completes the connection without any IP header, with no PSU IP', async () => {
    const response = await GET(callback({}));
    expect(response.headers.get('location')).toContain('bankConnected=');
    expect(mocks.completeConnection).toHaveBeenCalledWith('user-alex', 'abc', 'xyz', {
      psuIp: undefined,
      psuUserAgent: undefined,
    });
  });
});
