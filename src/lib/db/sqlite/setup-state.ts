/**
 * Process-wide record of a failed auth-DB bootstrap (src/lib/db/sqlite/
 * bootstrap.ts). While set, auth fails CLOSED: sign-up and session creation
 * are refused, `auth()` returns null and /api/auth answers 503. When the
 * bootstrap had to discard a DB it had just created (likely a wrong
 * ENCRYPTION_KEY), `dbDiscarded` also stops `getDb()` from re-creating it.
 * Cleared only by a restart after the cause is fixed. No imports on purpose
 * (client.ts depends on it).
 */

export interface SetupFailure {
  message: string;
  at: string;
  /** The just-created sampolio.db was closed and removed; never reopen it in this process. */
  dbDiscarded: boolean;
}

const globalForSetup = globalThis as typeof globalThis & { __sampolioSetupFailure?: SetupFailure };

export const SETUP_INCOMPLETE_CODE = 'SETUP_INCOMPLETE';
export const SETUP_INCOMPLETE_MESSAGE =
  'Sign-in is unavailable: the account database setup did not complete. The administrator must check the server log.';

export function markSetupFailed(error: unknown, options: { dbDiscarded: boolean }): SetupFailure {
  const failure: SetupFailure = {
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
    dbDiscarded: options.dbDiscarded,
  };
  globalForSetup.__sampolioSetupFailure = failure;
  return failure;
}

export function getSetupFailure(): SetupFailure | undefined {
  return globalForSetup.__sampolioSetupFailure;
}

/** Tests only. */
export function clearSetupFailure(): void {
  globalForSetup.__sampolioSetupFailure = undefined;
}
