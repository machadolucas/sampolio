// Better Auth HTTP rate-limit rules (src/lib/auth/server.ts `rateLimit`).
// Kept free of server-only imports so the DB maintenance job
// (src/lib/db/sqlite/maintenance.ts) can size its prune cutoff from the same
// numbers without loading Better Auth.

/** Windows are in seconds, as Better Auth expects. */
export const AUTH_RATE_LIMIT = {
  window: 60,
  max: 120,
  customRules: {
    '/sign-in/email': { window: 60, max: 10 },
    '/sign-up/email': { window: 60, max: 5 },
    '/change-password': { window: 60, max: 5 },
    '/passkey/verify-authentication': { window: 60, max: 10 },
    '/passkey/generate-authenticate-options': { window: 60, max: 30 },
    '/passkey/verify-registration': { window: 60, max: 10 },
  },
} as const;

/**
 * Windows of Better Auth 1.7.5's built-in special rules
 * (`getDefaultSpecialRules` in better-auth/dist/api/rate-limiter): 10 s for
 * /sign-in*, /sign-up*, /change-password*, /change-email*; 60 s for the
 * password-reset and verification-email paths. A customRule overrides them
 * per path, but they still apply to the paths it does not name. The passkey
 * plugin declares no rules of its own.
 */
export const BETTER_AUTH_BUILTIN_RULE_WINDOWS_S = [10, 60] as const;

/** The longest window any Sampolio rate-limit bucket can use, in ms. */
export function longestAuthRateLimitWindowMs(): number {
  const windows = [
    AUTH_RATE_LIMIT.window,
    ...BETTER_AUTH_BUILTIN_RULE_WINDOWS_S,
    ...Object.values(AUTH_RATE_LIMIT.customRules).map((rule) => rule.window),
  ];
  return Math.max(...windows) * 1000;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a `rateLimit` row is kept after its `lastRequest`: twice the
 * longest window, but at least a day. A row younger than its window is a live
 * bucket (deleting it would reset the count); older rows are dead, since the
 * next request to that key starts a new window anyway.
 */
export function rateLimitRowRetentionMs(): number {
  return Math.max(DAY_MS, 2 * longestAuthRateLimitWindowMs());
}
