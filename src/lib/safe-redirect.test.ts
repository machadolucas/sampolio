import { describe, expect, it } from 'vitest';
import { safeCallbackPath } from './safe-redirect';

const ORIGIN = 'https://app.example.com';

describe('safeCallbackPath', () => {
  it('keeps same-origin paths with query and hash', () => {
    expect(safeCallbackPath('/settings?tab=account#passkeys', ORIGIN)).toBe('/settings?tab=account#passkeys');
    expect(safeCallbackPath('/split/abc', ORIGIN)).toBe('/split/abc');
    expect(safeCallbackPath(`${ORIGIN}/overview`, ORIGIN)).toBe('/overview');
  });

  it.each([
    '/%09/evil.com',
    '/\t/evil.com',
    '//evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    'https://evil.com/',
    'http://app.example.com/', // other scheme = other origin
    'javascript:alert(1)',
    'data:text/html,hi',
    ' //evil.com',
    '/.//evil.com',
    '/%2F/evil.com',
    '/%5Cevil.com',
  ])('rejects %j', (raw) => {
    expect(safeCallbackPath(raw, ORIGIN)).toBe('/');
  });

  it('defaults to / for empty input', () => {
    expect(safeCallbackPath(null, ORIGIN)).toBe('/');
    expect(safeCallbackPath('', ORIGIN)).toBe('/');
  });
});
