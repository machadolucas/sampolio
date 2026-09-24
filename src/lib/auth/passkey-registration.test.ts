import * as crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTempDataDir } from '@/test/temp-data-dir';
import { getAuth, resetAuthForTests } from './server';
import { bootstrapDatabase } from '@/lib/db/sqlite/bootstrap';
import { closeDb, getDb } from '@/lib/db/sqlite/client';
import { passkey } from '@/lib/db/sqlite/schema';

/**
 * Full passkey registration against the real Better Auth instance, with a
 * software authenticator producing an `attestation: "none"` response — so the
 * `registration.afterVerification` naming in server.ts runs exactly as in a
 * browser, including the registering request's user agent.
 */

const ORIGIN = 'http://localhost:4998'; // AUTH_URL from useTempDataDir
const RP_ID = 'localhost';
const STRONG = 'Str0ng!pass';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1';
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ZERO_AAGUID = '00000000-0000-0000-0000-000000000000';
const ICLOUD_AAGUID = 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd';

let tmp: ReturnType<typeof useTempDataDir>;
let sessionCookie = '';

beforeAll(async () => {
  tmp = useTempDataDir('sampolio-passkey-reg-test-');
  closeDb();
  resetAuthForTests();
  expect((await bootstrapDatabase()).ok).toBe(true);
  await getAuth().api.signUpEmail({ body: { name: 'Alex', email: 'alex@example.com', password: STRONG } });
  const { headers } = await getAuth().api.signInEmail({
    body: { email: 'alex@example.com', password: STRONG },
    returnHeaders: true,
  });
  sessionCookie = cookiesFrom(headers);
});

afterAll(() => {
  closeDb();
  resetAuthForTests();
  tmp.cleanup();
});

function cookiesFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

// --- minimal CBOR encoder (unsigned/negative ints, byte/text strings, maps) ---
function cborHead(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(value, 1);
  return b;
}
type Cbor = number | string | Buffer | Map<number | string, Cbor>;
function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  const parts = [cborHead(5, value.size)];
  for (const [k, v] of value) parts.push(cbor(k), cbor(v));
  return Buffer.concat(parts);
}

const b64url = (buf: Buffer) => buf.toString('base64url');

function attestationNone(challenge: string, aaguid: string) {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const coseKey = new Map<number, Cbor>([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, Buffer.from(jwk.x!, 'base64url')],
    [-3, Buffer.from(jwk.y!, 'base64url')],
  ]);
  const credentialId = crypto.randomBytes(16);
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(credentialId.length);
  const authData = Buffer.concat([
    crypto.createHash('sha256').update(RP_ID).digest(),
    Buffer.from([0x45]), // UP | UV | AT
    Buffer.alloc(4), // signCount 0
    Buffer.from(aaguid.replace(/-/g, ''), 'hex'),
    credIdLen,
    credentialId,
    cbor(coseKey),
  ]);
  const attestationObject = cbor(
    new Map<string, Cbor>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]),
  );
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN, crossOrigin: false }),
  );
  return {
    id: b64url(credentialId),
    rawId: b64url(credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: b64url(clientDataJSON),
      attestationObject: b64url(attestationObject),
      transports: ['internal', 'hybrid'],
    },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
  };
}

/** generate-register-options → verify-registration, as the Settings panel does. */
async function registerPasskey(opts: { aaguid: string; userAgent: string; name?: string }) {
  const auth = getAuth();
  const optionsRes = await auth.handler(
    new Request(`${ORIGIN}/api/auth/passkey/generate-register-options`, {
      headers: { cookie: sessionCookie, 'user-agent': opts.userAgent },
    }),
  );
  expect(optionsRes.status).toBe(200);
  const { challenge } = (await optionsRes.json()) as { challenge: string };
  const cookie = [sessionCookie, cookiesFrom(optionsRes.headers)].filter(Boolean).join('; ');

  const credential = attestationNone(challenge, opts.aaguid);
  const verifyRes = await auth.handler(
    new Request(`${ORIGIN}/api/auth/passkey/verify-registration`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: ORIGIN, 'user-agent': opts.userAgent },
      body: JSON.stringify({ response: credential, ...(opts.name ? { name: opts.name } : {}) }),
    }),
  );
  const body = await verifyRes.json();
  expect(verifyRes.status, JSON.stringify(body)).toBe(200);
  return getDb().select().from(passkey).where(eq(passkey.credentialID, credential.id)).get()!;
}

describe('passkey registration default name', () => {
  it('names an all-zero-AAGUID passkey after the registering device', async () => {
    const row = await registerPasskey({ aaguid: ZERO_AAGUID, userAgent: IPHONE_SAFARI });
    expect(row.aaguid).toBe(ZERO_AAGUID);
    expect(row.name).toBe('Safari on iPhone');
  });

  it('keeps the provider name for a known AAGUID', async () => {
    const row = await registerPasskey({ aaguid: ICLOUD_AAGUID, userAgent: MAC_CHROME });
    expect(row.name).toBe('Apple Passwords');
  });

  it('falls back to "Passkey" without a recognisable user agent', async () => {
    const row = await registerPasskey({ aaguid: ZERO_AAGUID, userAgent: 'curl/8.7.1' });
    expect(row.name).toBe('Passkey');
  });

  it('lets a client-sent name win', async () => {
    const row = await registerPasskey({ aaguid: ZERO_AAGUID, userAgent: IPHONE_SAFARI, name: 'Work phone' });
    expect(row.name).toBe('Work phone');
  });
});
