import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BankApiError, describeBankError, getAspsps, redactBankError } from './client';

vi.mock('./jwt', () => ({ getAppToken: vi.fn(async () => 'test-token') }));

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function requestError(response: Response): Promise<BankApiError> {
  vi.stubGlobal('fetch', vi.fn(async () => response));
  try {
    await getAspsps('FI');
    throw new Error('Expected request to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(BankApiError);
    return error as BankApiError;
  }
}

describe('Enable Banking client error responses', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_BANKING_APP_ID', 'test-app');
    vi.stubEnv('ENABLE_BANKING_REDIRECT_URL', 'https://example.com/callback');
    vi.stubEnv('ENABLE_BANKING_PRIVATE_KEY_FILE', '/tmp/test-key.pem');
    vi.stubEnv('ENABLE_BANKING_BASE_URL', 'https://api.example.test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('prefers textual error over the numeric HTTP code and keeps machine code safe', async () => {
    const error = await requestError(
      errorResponse(401, { code: 401, error: 'EXPIRED_SESSION', message: 'private detail' })
    );
    expect(error).toMatchObject({ code: 'EXPIRED_SESSION', status: 401, apiCode: 'EXPIRED_SESSION' });
    expect(describeBankError(error)).toContain('private detail');
  });

  it.each(
    ['EXPIRED_SESSION', 'CLOSED_SESSION', 'REVOKED_SESSION'].flatMap((providerCode) =>
      [400, 401, 403].map((status) => [providerCode, status] as const)
    )
  )('classifies explicit %s on HTTP %s as expired consent', async (providerCode, status) => {
    const error = await requestError(errorResponse(status, { code: status, error: providerCode }));
    expect(error.code).toBe('EXPIRED_SESSION');
  });

  it.each([401, 403])('classifies generic HTTP %s as application auth failure', async (status) => {
    const error = await requestError(
      errorResponse(status, { code: status, error: 'Credentials rejected for account 12345' })
    );
    expect(error).toMatchObject({ code: 'AUTH_FAILED', status, apiCode: undefined });
    expect(redactBankError(error)).not.toContain('12345');
    expect(redactBankError(error)).not.toContain('Credentials');
  });

  it('accepts a legacy string code only when textual error is unavailable', async () => {
    const error = await requestError(errorResponse(400, { code: 'ASPSP_TIMEOUT' }));
    expect(error).toMatchObject({ code: 'TRANSIENT', status: 400, apiCode: 'ASPSP_TIMEOUT' });
  });

  it('uses the textual error when both current and legacy fields are strings', async () => {
    const error = await requestError(
      errorResponse(400, { code: 'INVALID_REQUEST', error: 'ASPSP_RATE_LIMIT_EXCEEDED' })
    );
    expect(error).toMatchObject({ code: 'RATE_LIMITED', apiCode: 'ASPSP_RATE_LIMIT_EXCEEDED' });
  });

  it('treats HTTP 408 and ASPSP_TIMEOUT as transient', async () => {
    await expect(requestError(errorResponse(408, { code: 408, error: 'Request timed out' }))).resolves.toMatchObject({
      code: 'TRANSIENT',
    });
    await expect(requestError(errorResponse(400, { code: 400, error: 'ASPSP_TIMEOUT' }))).resolves.toMatchObject({
      code: 'TRANSIENT',
    });
  });

  it.each([
    [429, { code: 429, error: 'Too many requests' }],
    [400, { code: 400, error: 'ASPSP_RATE_LIMIT_EXCEEDED' }],
    [503, { code: 503, error: 'Unavailable' }],
  ])('maps status %s to the appropriate retry category', async (status, body) => {
    const error = await requestError(errorResponse(status, body));
    expect(error.code).toBe(status === 429 || status === 400 ? 'RATE_LIMITED' : 'TRANSIENT');
  });

  it.each([
    ['malformed fields', 400, { code: { nested: 'private' }, error: { message: 'private' }, message: 9 }],
    ['missing fields', 400, {}],
    ['null envelope', 400, null],
    ['array envelope', 400, []],
  ])('ignores unvalidated %s and remains redacted', async (_label, status, body) => {
    const error = await requestError(errorResponse(status, body));
    expect(error).toMatchObject({ code: 'UNKNOWN', status, apiCode: undefined });
    expect(redactBankError(error)).not.toContain('private');
    expect(error.apiCode).toBeUndefined();
  });

  it('handles a non-JSON body without exposing it through the redacted description', async () => {
    const error = await requestError(new Response('account 12345 failed', { status: 400 }));
    expect(error).toMatchObject({ code: 'UNKNOWN', status: 400, apiCode: undefined });
    expect(redactBankError(error)).not.toContain('12345');
    expect(redactBankError(error)).not.toContain('failed');
  });
});
