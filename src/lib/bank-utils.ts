/**
 * Pure, client-safe bank helpers (no server / DB / fs imports) — the consent
 * expiry detection mirrors `isEuriborUpdateDue` so the Overview banner can reuse
 * the same one-glance pattern, plus an IBAN mask used everywhere in the UI.
 */

import type { BankConnection } from '@/types';
import { CONSENT_EXPIRY_WARNING_DAYS } from './bank/constants';

export interface ConsentExpiryInfo {
  /** Consent is past its valid_until or the connection is marked expired. */
  expired: boolean;
  /** Active consent within the warning window — prompt a one-click reconnect. */
  expiringSoon: boolean;
  /** Whole days until expiry (negative once past); null when no expiry recorded. */
  daysUntilExpiry: number | null;
  expiresAt: Date | null;
}

const MS_PER_DAY = 86_400_000;

export function getConsentExpiryInfo(
  connection: Pick<BankConnection, 'status' | 'consentExpiresAt'>,
  now: Date = new Date()
): ConsentExpiryInfo {
  if (!connection.consentExpiresAt) {
    return {
      expired: connection.status === 'expired',
      expiringSoon: false,
      daysUntilExpiry: null,
      expiresAt: null,
    };
  }
  const expiresAt = new Date(connection.consentExpiresAt);
  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / MS_PER_DAY);
  const expired = connection.status === 'expired' || connection.status === 'revoked' || daysUntilExpiry <= 0;
  const expiringSoon = !expired && daysUntilExpiry <= CONSENT_EXPIRY_WARNING_DAYS;
  return { expired, expiringSoon, daysUntilExpiry, expiresAt };
}

/** True when a connection needs the user's attention (expired or expiring soon). */
export function isConsentExpiringSoon(
  connection: Pick<BankConnection, 'status' | 'consentExpiresAt'>,
  now: Date = new Date()
): boolean {
  const info = getConsentExpiryInfo(connection, now);
  return info.expired || info.expiringSoon;
}

/** Mask an IBAN for display: "FI••••1234". Never show the full IBAN. */
export function maskIban(iban?: string): string {
  if (!iban) return '';
  const s = iban.replace(/\s+/g, '');
  if (s.length <= 6) return '••••';
  return `${s.slice(0, 2)}••••${s.slice(-4)}`;
}
