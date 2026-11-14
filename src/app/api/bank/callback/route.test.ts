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
    expect(response.headers.get('location')).toBe('https://sampolio.example.com/settings?tab=banking&bankConnected=Example%20Bank');
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

describe('bank callback outcomes', () => {
  it('redirects cancellation and technical provider errors without exposing provider text', async () => {
    for (const [error, expected] of [['access_denied', 'cancelled'], ['sensitive-provider-detail', 'provider_failed']]) {
      const response = await GET(new NextRequest(`http://localhost/api/bank/callback?error=${error}&state=xyz`));
      expect(response.headers.get('location')).toBe(`https://sampolio.example.com/settings?tab=banking&bankError=${expected}`);
      expect(response.headers.get('location')).not.toContain(error);
    }
    expect(mocks.completeConnection).not.toHaveBeenCalled();
  });

  it('requires authentication and rejects missing or unknown state', async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await GET(callback({}))).headers.get('location')).toBe('https://sampolio.example.com/auth/signin?callbackUrl=%2Fsettings%3Ftab%3Dbanking');
    expect((await GET(new NextRequest('http://localhost/api/bank/callback?code=abc'))).headers.get('location')).toContain('bankError=missing_params');
    mocks.completeConnection.mockResolvedValueOnce(null);
    expect((await GET(callback({}))).headers.get('location')).toContain('bankError=invalid_state');
  });

  it('returns a safe failure on exchange or network error', async () => {
    mocks.completeConnection.mockRejectedValueOnce(new Error('sensitive-provider-detail'));
    const response = await GET(callback({}));
    expect(response.headers.get('location')).toBe('https://sampolio.example.com/settings?tab=banking&bankError=connect_failed');
    expect(response.headers.get('location')).not.toContain('sensitive-provider-detail');
  });
});
