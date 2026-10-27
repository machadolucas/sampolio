import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEncryptionKey } from './encryption';

describe('getEncryptionKey', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns ENCRYPTION_KEY when set', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
    expect(getEncryptionKey()).toBe('a'.repeat(64));
  });

  it('refuses the default key in production', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getEncryptionKey()).toThrow(/must be set in production/);
  });

  it('falls back to the dev key outside production, with a warning', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getEncryptionKey()).toBe('sampolio-default-encryption-key-change-in-prod');
    expect(warn).toHaveBeenCalled();
  });
});
