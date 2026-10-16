import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/db/user-preferences', () => ({ getUserPreferences: vi.fn() }));

import { __resetDevIsolationWarningsForTests, isBlockedInDevelopment, isLoopbackUrl } from './dev-isolation';
import { getBankConfig } from './bank/constants';
import { getSplitNotifyConfig } from './split-notify';

const bankEnv = {
  ENABLE_BANKING_APP_ID: 'app-id',
  ENABLE_BANKING_REDIRECT_URL: 'https://app.example.com/api/bank/callback',
  ENABLE_BANKING_PRIVATE_KEY_FILE: '/tmp/key.pem',
};

describe('dev isolation', () => {
  beforeEach(() => {
    __resetDevIsolationWarningsForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const [k, v] of Object.entries(bankEnv)) vi.stubEnv(k, v);
    vi.stubEnv('AUTH_URL', 'https://app.example.com');
    vi.stubEnv('HA_WEBHOOK_URL', 'https://ha.example.com/api/webhook/secret');
    vi.stubEnv('SAMPOLIO_DEV_EXTERNAL_APIS', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('leaves production and tests untouched', () => {
    for (const env of ['production', 'test']) {
      vi.stubEnv('NODE_ENV', env);
      expect(isBlockedInDevelopment('enable-banking')).toBe(false);
      expect(getBankConfig()).not.toBeNull();
      expect(getSplitNotifyConfig()?.webhookUrl).toBe('https://ha.example.com/api/webhook/secret');
    }
  });

  it('turns both integrations off under next dev and warns once', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(getBankConfig()).toBeNull();
    expect(getBankConfig()).toBeNull();
    expect(getSplitNotifyConfig()).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(2);
    // The warning never echoes a secret.
    const logged = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(logged).not.toContain('secret');
    expect(logged).not.toContain('app-id');
  });

  it('still allows a loopback HA webhook under next dev (local e2e listener)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HA_WEBHOOK_URL', 'http://localhost:8787/webhook');
    expect(getSplitNotifyConfig()?.webhookUrl).toBe('http://localhost:8787/webhook');
    expect(getBankConfig()).toBeNull();
  });

  it('honours the explicit opt-in', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SAMPOLIO_DEV_EXTERNAL_APIS', '1');
    expect(getBankConfig()).not.toBeNull();
    expect(getSplitNotifyConfig()).not.toBeNull();
  });

  it('recognises loopback URLs only', () => {
    expect(isLoopbackUrl('http://localhost:8787/x')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1/x')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:9000/x')).toBe(true);
    expect(isLoopbackUrl('http://hooks.localhost/x')).toBe(true);
    expect(isLoopbackUrl('https://ha.example.com/x')).toBe(false);
    expect(isLoopbackUrl('http://localhost.example.com/x')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});
