/**
 * Enable Banking — configuration + tunable constants.
 *
 * Secrets follow the app convention: ids/URLs in ~/sampolio/.env (baked into the
 * launchd plist), the RSA private key in a 0600 PEM file *outside* the repo,
 * referenced by path. A missing required secret HARD-DISABLES the feature — we
 * never default a secret. `getBankConfig()` returns null in that case and every
 * caller bails out gracefully.
 */

/** Enable Banking API base (override with ENABLE_BANKING_BASE_URL for sandbox). */
export const DEFAULT_API_BASE_URL = 'https://api.enablebanking.com';

/** JWT (Layer A) — app token claims. RS256, header kid = application id. */
export const JWT_ISSUER = 'enablebanking.com';
export const JWT_AUDIENCE = 'api.enablebanking.com';
/** Token lifetime; the API allows max 24h. */
export const JWT_TTL_SECONDS = 23 * 60 * 60; // 23h, a margin under the 24h cap
/** Re-mint this long before expiry so a request never races the boundary. */
export const JWT_REMINT_SKEW_SECONDS = 5 * 60;

/** Consent (Layer B) — how long an access we request (bank may shorten it). */
export const CONSENT_REQUESTED_VALIDITY_DAYS = 180;
/** Warn the user this many days before the consent expires. */
export const CONSENT_EXPIRY_WARNING_DAYS = 14;

/**
 * Transaction windows. Sampolio doesn't model the past, so we fetch only a
 * short window (one card cycle) — this also sidesteps the ~1h deep-history limit.
 */
export const BACKFILL_DAYS = 60;
/** Incremental fetches re-pull a small overlap; the dedup upsert absorbs it. */
export const INCREMENTAL_OVERLAP_DAYS = 3;

/**
 * Rate budget — the documented limit is ~4 *unattended* fetches per day PER
 * ACCOUNT. We default to 2 scheduled/day and reserve headroom for on-demand
 * "Refresh now" so we never exhaust the bank's allowance.
 */
export const PER_ACCOUNT_DAILY_LIMIT = 4;
export const RESERVED_ON_DEMAND_FETCHES = 1;
export const MAX_SCHEDULED_FETCHES_PER_DAY = 2;
/** Soft floor between two manual refreshes of the same connection. */
export const MIN_MANUAL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
/** How often the in-process scheduler wakes to check `nextSyncDueAt`. */
export const SCHEDULER_TICK_MS = 30 * 60 * 1000;
/** Backoff applied after a 429 / rate-limit response. */
export const RATE_LIMIT_BACKOFF_MS = 6 * 60 * 60 * 1000; // 6h
/** Backoff applied after a transient (5xx/network) failure. */
export const TRANSIENT_BACKOFF_MS = 60 * 60 * 1000; // 1h

export interface BankConfig {
  appId: string; // the JWT `kid`
  redirectUrl: string; // must match what's registered in the control panel
  baseUrl: string;
  privateKeyFile: string; // path to a 0600 PKCS#8 PEM, outside the repo
}

/**
 * Resolve the Enable Banking configuration from the environment. Returns null
 * (feature disabled) when any required secret is missing — callers must treat
 * null as "feature off", never substitute a default.
 */
export function getBankConfig(): BankConfig | null {
  const appId = process.env.ENABLE_BANKING_APP_ID?.trim();
  const redirectUrl = process.env.ENABLE_BANKING_REDIRECT_URL?.trim();
  const privateKeyFile = process.env.ENABLE_BANKING_PRIVATE_KEY_FILE?.trim();
  const baseUrl = process.env.ENABLE_BANKING_BASE_URL?.trim() || DEFAULT_API_BASE_URL;

  if (!appId || !redirectUrl || !privateKeyFile) {
    return null;
  }
  return { appId, redirectUrl, baseUrl, privateKeyFile };
}

/** True when the feature has all required secrets and is therefore enabled. */
export function isBankFeatureConfigured(): boolean {
  return getBankConfig() !== null;
}
