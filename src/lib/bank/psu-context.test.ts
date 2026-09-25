import { describe, expect, it } from 'vitest';
import { clientIpFrom } from '@/lib/rate-limit';
import { psuContextFrom } from './psu-context';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15';

describe('psuContextFrom', () => {
  it('uses cf-connecting-ip on the tunnel path, ignoring a client-prepended X-Forwarded-For', () => {
    // Cloudflare appends the real peer to whatever XFF the client sent.
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '10.0.0.1, 203.0.113.7',
      'user-agent': UA,
    });
    expect(psuContextFrom(headers)).toEqual({ psuIp: '203.0.113.7', psuUserAgent: UA });
  });

  it('uses the first X-Forwarded-For hop on the LAN path (Caddy replaces the header)', () => {
    const headers = new Headers({ 'x-forwarded-for': '192.168.1.50', 'user-agent': UA });
    expect(psuContextFrom(headers)).toEqual({ psuIp: '192.168.1.50', psuUserAgent: UA });
  });

  it('leaves psuIp out when no header names the client, instead of sending "unknown"', () => {
    expect(psuContextFrom(new Headers({ 'user-agent': UA }))).toEqual({ psuIp: undefined, psuUserAgent: UA });
    expect(psuContextFrom(new Headers())).toEqual({ psuIp: undefined, psuUserAgent: undefined });
  });

  it('treats blank headers as absent', () => {
    const headers = new Headers({ 'cf-connecting-ip': '  ', 'x-forwarded-for': ' , 198.51.100.4' });
    expect(psuContextFrom(headers).psuIp).toBeUndefined();
    expect(clientIpFrom(headers)).toBe('unknown');
  });

  it('ignores X-Real-IP (only the Caddy LAN path sets it, and XFF already covers that)', () => {
    expect(psuContextFrom(new Headers({ 'x-real-ip': '192.168.1.50' })).psuIp).toBeUndefined();
  });
});
