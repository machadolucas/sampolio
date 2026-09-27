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
  });
});
