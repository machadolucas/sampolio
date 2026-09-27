import { describe, it, expect } from 'vitest';
import { isLoopbackDevRequest } from './dev-loopback';

const h = (init: Record<string, string>) => new Headers(init);

describe('isLoopbackDevRequest', () => {
  it('accepts loopback hosts with or without a port', () => {
    expect(isLoopbackDevRequest(h({ host: 'localhost:4999' }))).toBe(true);
    expect(isLoopbackDevRequest(h({ host: '127.0.0.1:4999' }))).toBe(true);
    expect(isLoopbackDevRequest(h({ host: '[::1]:4999' }))).toBe(true);
    expect(isLoopbackDevRequest(h({ host: 'LOCALHOST' }))).toBe(true);
  });

  it('refuses LAN / public hosts and a missing host', () => {
    expect(isLoopbackDevRequest(h({ host: '192.168.1.20:4999' }))).toBe(false);
    expect(isLoopbackDevRequest(h({ host: 'mac-mini.local:4999' }))).toBe(false);
    expect(isLoopbackDevRequest(h({ host: 'localhost.example.com' }))).toBe(false);
    expect(isLoopbackDevRequest(h({}))).toBe(false);
  });

  it('refuses anything that came through a proxy or tunnel', () => {
    for (const header of ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'cf-connecting-ip']) {
      expect(isLoopbackDevRequest(h({ host: 'localhost:4999', [header]: '203.0.113.7' })), header).toBe(false);
    }
    expect(isLoopbackDevRequest(h({ host: 'localhost:4999', 'x-forwarded-for': '127.0.0.1, 203.0.113.7' }))).toBe(false);
    expect(isLoopbackDevRequest(h({ host: 'localhost:4999', 'x-forwarded-host': 'sampolio.example.com' }))).toBe(false);
  });

  it('accepts the x-forwarded-* headers Next itself adds to a direct loopback request', () => {
    // base-server fills x-forwarded-host from Host and x-forwarded-for from the socket address.
    for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopbackDevRequest(h({
        host: 'localhost:4999',
        'x-forwarded-host': 'localhost:4999',
        'x-forwarded-for': addr,
        'x-forwarded-proto': 'http',
        'x-forwarded-port': '4999',
      })), addr).toBe(true);
    }
  });
});
