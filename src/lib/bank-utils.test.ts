import { describe, it, expect } from 'vitest';
import { getConsentExpiryInfo, isConsentExpiringSoon, maskIban } from './bank-utils';
import type { BankConnection } from '@/types';

const now = new Date('2026-06-24T12:00:00.000Z');

function conn(overrides: Partial<BankConnection>): Pick<BankConnection, 'status' | 'consentExpiresAt'> {
  return { status: 'active', ...overrides } as BankConnection;
}

describe('getConsentExpiryInfo', () => {
  it('flags an active consent far from expiry as fine', () => {
    const info = getConsentExpiryInfo(conn({ consentExpiresAt: '2026-12-01T00:00:00.000Z' }), now);
    expect(info.expired).toBe(false);
    expect(info.expiringSoon).toBe(false);
    expect(info.daysUntilExpiry).toBeGreaterThan(14);
  });

  it('flags a consent within the warning window as expiring soon', () => {
    const info = getConsentExpiryInfo(conn({ consentExpiresAt: '2026-07-01T00:00:00.000Z' }), now);
    expect(info.expired).toBe(false);
    expect(info.expiringSoon).toBe(true);
    expect(info.daysUntilExpiry).toBeLessThanOrEqual(14);
  });

  it('flags a past expiry as expired', () => {
    const info = getConsentExpiryInfo(conn({ consentExpiresAt: '2026-06-01T00:00:00.000Z' }), now);
    expect(info.expired).toBe(true);
    expect(info.expiringSoon).toBe(false);
  });

  it('treats an expired status as expired even without a date', () => {
    const info = getConsentExpiryInfo(conn({ status: 'expired', consentExpiresAt: undefined }), now);
    expect(info.expired).toBe(true);
    expect(info.daysUntilExpiry).toBeNull();
  });
});

describe('isConsentExpiringSoon', () => {
  it('is true for expired and expiring-soon, false otherwise', () => {
    expect(isConsentExpiringSoon(conn({ consentExpiresAt: '2026-06-01T00:00:00.000Z' }), now)).toBe(true);
    expect(isConsentExpiringSoon(conn({ consentExpiresAt: '2026-07-01T00:00:00.000Z' }), now)).toBe(true);
    expect(isConsentExpiringSoon(conn({ consentExpiresAt: '2026-12-01T00:00:00.000Z' }), now)).toBe(false);
  });
});

describe('maskIban', () => {
  it('masks all but the country prefix and last 4', () => {
    expect(maskIban('FI2112345600000785')).toBe('FI••••0785');
    expect(maskIban('FI21 1234 5600 0007 85')).toBe('FI••••0785');
  });
  it('returns a generic mask for short/empty input', () => {
    expect(maskIban('')).toBe('');
    expect(maskIban('FI12')).toBe('••••');
  });
});
