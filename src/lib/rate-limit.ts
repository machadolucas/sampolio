/**
 * Tiny in-process fixed-window rate limiter for server actions that call
 * Better Auth through `auth.api.*` (Better Auth's own rate limiter only runs
 * on its HTTP router). Single-node and reset on restart, like the login
 * lockout in src/lib/db/users.ts.
 */

interface Window {
  count: number;
  resetAt: number;
}

const globalForLimits = globalThis as typeof globalThis & { __sampolioActionLimits?: Map<string, Window> };
const windows = (globalForLimits.__sampolioActionLimits ??= new Map<string, Window>());

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (0 when allowed). */
  retryAfter: number;
}

/** Count one hit on `key`; refuse once `max` hits happened within `windowMs`. */
export function consumeRateLimit(key: string, max: number, windowMs: number, now = Date.now()): RateLimitResult {
  const current = windows.get(key);
  if (!current || now >= current.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  if (current.count >= max) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

/** Tests only. */
export function resetRateLimits(): void {
  windows.clear();
}

/** What `clientIpFrom` returns when no header names the client. */
export const UNKNOWN_CLIENT_IP = 'unknown';

/**
 * Best-effort client IP (same header order as Better Auth's
 * `advanced.ipAddress.ipAddressHeaders`). `cf-connecting-ip` comes first
 * because Cloudflare's edge overwrites it on the tunnel path, whereas it
 * *appends* to `x-forwarded-for`, so the first XFF hop there is whatever the
 * client sent. On the LAN path Caddy strips `cf-connecting-ip` and replaces
 * `x-forwarded-for` with the peer address, so its first hop is trustworthy.
 * Used for rate-limit keys and the Enable Banking PSU IP.
 */
export function clientIpFrom(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const xff = headers.get('x-forwarded-for')?.split(',')[0].trim();
  if (xff) return xff;
  return UNKNOWN_CLIENT_IP;
}
