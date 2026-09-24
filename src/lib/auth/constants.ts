// Auth constants shared by the server config (src/lib/auth/server.ts) and the
// browser (sign-in page, passkeys panel). No server-only imports here.

/**
 * Passkey registration needs a session younger than this. `session.freshAge`
 * must stay 0 (Better Auth's freshSessionMiddleware also guards
 * /list-sessions, /unlink-account and /delete-user), so this narrower guard on
 * /passkey/generate-register-options stops a stolen, older session cookie
 * from enrolling a passkey that would survive a password change.
 * A session from any sign-in method (password or passkey) counts.
 */
export const PASSKEY_REGISTRATION_MAX_SESSION_AGE_MS = 10 * 60 * 1000;

/** APIError body.code returned when that guard refuses registration. */
export const PASSKEY_REAUTH_REQUIRED = 'PASSKEY_REAUTH_REQUIRED';

/** Where "sign in again" sends the user back to: Settings › Account. */
export const ACCOUNT_SETTINGS_PATH = '/settings?tab=account';
