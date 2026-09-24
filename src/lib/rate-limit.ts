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

/** Best-effort client IP for rate-limit keys (same headers as Better Auth's config). */
export function clientIpFrom(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}
