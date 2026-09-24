import { describe, expect, it } from 'vitest';
import { DEFAULT_PASSKEY_NAME, defaultPasskeyName, describeDevice } from './passkey-name';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 26_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  windowsOpera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0',
};

const ZERO_AAGUID = '00000000-0000-0000-0000-000000000000';
const ICLOUD_AAGUID = 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd';
const ONEPASSWORD_AAGUID = 'bada5566-a7aa-401f-bd96-45619a55120d';

describe('describeDevice', () => {
  it.each([
    [UA.iphoneSafari, 'Safari on iPhone', 'phone'],
    [UA.ipadSafari, 'Safari on iPad', 'tablet'],
    [UA.macSafari, 'Safari on Mac', 'desktop'],
    [UA.macChrome, 'Chrome on Mac', 'desktop'],
    [UA.windowsEdge, 'Edge on Windows', 'desktop'],
    [UA.windowsOpera, 'Opera on Windows', 'desktop'],
    [UA.androidChrome, 'Chrome on Android', 'phone'],
    [UA.linuxFirefox, 'Firefox on Linux', 'desktop'],
  ])('%s → %s', (ua, label, form) => {
    expect(describeDevice(ua)).toEqual({ label, form });
  });

  it('falls back to what it can recognise', () => {
    expect(describeDevice('SomeBot/1.0 (Windows NT 10.0)')).toEqual({ label: 'Windows', form: 'desktop' });
    expect(describeDevice('curl/8.7.1')).toEqual({ label: 'Unknown device', form: 'unknown' });
    expect(describeDevice('')).toEqual({ label: 'Unknown device', form: 'unknown' });
    expect(describeDevice(null)).toEqual({ label: 'Unknown device', form: 'unknown' });
  });
});

describe('defaultPasskeyName', () => {
  it('names a known AAGUID after its provider, ignoring the user agent', () => {
    expect(defaultPasskeyName(ICLOUD_AAGUID, UA.iphoneSafari)).toBe('Apple Passwords');
    expect(defaultPasskeyName(ONEPASSWORD_AAGUID.toUpperCase(), UA.macChrome)).toBe('1Password');
  });

  it('uses the registering device for the all-zero AAGUID Apple reports', () => {
    expect(defaultPasskeyName(ZERO_AAGUID, UA.iphoneSafari)).toBe('Safari on iPhone');
    expect(defaultPasskeyName(ZERO_AAGUID, UA.macSafari)).toBe('Safari on Mac');
  });

  it('uses the device for a missing or unmapped AAGUID too', () => {
    expect(defaultPasskeyName(undefined, UA.androidChrome)).toBe('Chrome on Android');
    expect(defaultPasskeyName('12345678-1234-1234-1234-123456789abc', UA.windowsEdge)).toBe('Edge on Windows');
  });

  it('falls back to "Passkey" when neither says anything', () => {
    expect(DEFAULT_PASSKEY_NAME).toBe('Passkey');
    expect(defaultPasskeyName(ZERO_AAGUID, undefined)).toBe('Passkey');
    expect(defaultPasskeyName(null, 'curl/8.7.1')).toBe('Passkey');
  });
});
