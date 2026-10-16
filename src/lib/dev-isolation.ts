/**
 * Keeps development servers away from production's external services.
 *
 * `next dev` auto-loads the repo-root `.env`, and that file carries the REAL
 * Home Assistant webhook and Enable Banking credentials (it is the source
 * `scripts/install-launchd.sh` bakes production's environment from, so they
 * cannot simply be removed). Without this guard a preview running on a copy of
 * production data would start the bank scheduler against the live connections
 * and push real split notifications to household members.
 *
 * Under `next dev` (NODE_ENV=development) the integrations therefore resolve to
 * "not configured" unless explicitly opted in with `SAMPOLIO_DEV_EXTERNAL_APIS=1`.
 * A loopback HA webhook (a local listener) is always allowed — it is how split
 * notifications are tested end to end. Production (`next start`) and tests
 * (NODE_ENV=test) are unaffected.
 *
 * SERVER-ONLY PLAIN MODULE — no secrets are logged.
 */

export const DEV_EXTERNAL_APIS_ENV = 'SAMPOLIO_DEV_EXTERNAL_APIS';

const warned = new Set<string>();

/** True when external integration `name` must stay off in this process. */
export function isBlockedInDevelopment(name: 'enable-banking' | 'ha-webhook'): boolean {
  if (process.env.NODE_ENV !== 'development') return false;
  if (process.env[DEV_EXTERNAL_APIS_ENV]?.trim() === '1') return false;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(
      `[dev-isolation] ${name} disabled under next dev (production credentials from .env are ignored); set ${DEV_EXTERNAL_APIS_ENV}=1 to opt in`,
    );
  }
  return true;
}

/** True for http(s) URLs whose host is this machine (localhost, 127.0.0.0/8, ::1). */
export function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host);
  } catch {
    return false;
  }
}

/** Test-only: forget which integrations already logged their warning. */
export function __resetDevIsolationWarningsForTests(): void {
  warned.clear();
}
