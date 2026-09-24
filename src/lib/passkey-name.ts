import { getAuthenticatorName } from '@better-auth/passkey';

/**
 * Default labels for new passkeys (mirrors Virtual Home's
 * `src/domain/passkeyProviders.ts` + `deviceLabel.ts`).
 *
 * An AAGUID names an authenticator *model* and arrives only with the
 * registration response, so it is the one hint about where a passkey lives.
 * The plugin's map (`getAuthenticatorName`) turns the common ones into
 * "Apple Passwords", "1Password", … But several platforms report the
 * all-zero AAGUID under `attestation: "none"` (Apple devices usually do),
 * which matches nothing. Then the registering browser's user agent
 * ("Safari on iPhone") is the fallback, and plain "Passkey" the last resort.
 * The user can rename a passkey afterwards; a name the client sends always
 * wins over all of this.
 *
 * Pure and dependency-light so the auth config and tests can share it.
 */

export const DEFAULT_PASSKEY_NAME = 'Passkey';

export interface DeviceLabel {
  /** e.g. "Safari on iPhone". Never empty. */
  label: string;
  form: 'phone' | 'tablet' | 'desktop' | 'unknown';
}

const UNKNOWN_DEVICE = 'Unknown device';

/**
 * A raw `User-Agent` turned into something a person recognises. Deliberately
 * shallow: a hint for the owner, not fingerprinting, so a wrong guess costs
 * nothing.
 */
export function describeDevice(userAgent: string | null | undefined): DeviceLabel {
  const ua = (userAgent ?? '').trim();
  if (ua === '') return { label: UNKNOWN_DEVICE, form: 'unknown' };

  const platform = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/i.test(ua)
          ? 'Mac'
          : /Windows/i.test(ua)
            ? 'Windows'
            : /Linux/i.test(ua)
              ? 'Linux'
              : null;

  // Order matters: Edge, Opera and Chrome all also claim "Safari".
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\//i.test(ua)
      ? 'Opera'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Chrome\//i.test(ua)
          ? 'Chrome'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : null;

  const form: DeviceLabel['form'] =
    platform === 'iPhone' || platform === 'Android'
      ? 'phone'
      : platform === 'iPad'
        ? 'tablet'
        : platform === 'Mac' || platform === 'Windows' || platform === 'Linux'
          ? 'desktop'
          : 'unknown';

  if (browser && platform) return { label: `${browser} on ${platform}`, form };
  if (browser) return { label: browser, form };
  if (platform) return { label: platform, form };
  return { label: UNKNOWN_DEVICE, form: 'unknown' };
}

/**
 * The label a new passkey gets when the user did not type one: the provider
 * when the AAGUID is known, else the registering device ("Safari on iPhone"),
 * else "Passkey". The user-agent fallback applies only when the AAGUID is
 * missing, all-zero or not in the map.
 */
export function defaultPasskeyName(aaguid: string | null | undefined, userAgent: string | null | undefined): string {
  const provider = getAuthenticatorName(aaguid);
  if (provider) return provider;
  const device = describeDevice(userAgent);
  return device.label === UNKNOWN_DEVICE ? DEFAULT_PASSKEY_NAME : device.label;
}
