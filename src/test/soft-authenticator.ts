import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/**
 * A minimal software WebAuthn authenticator for tests (the same helper as
 * Lumo's apps/web/src/test/soft-authenticator.ts): one P-256 (ES256)
 * credential, `none` attestation, user-present + user-verified flags and a
 * signature counter. It produces exactly the JSON a browser's
 * `navigator.credentials.create()/get()` hands `@simplewebauthn/browser`, so a
 * test can drive Better Auth's real `/passkey/*` endpoints — the registration
 * and assertion are verified by `@simplewebauthn/server` like any other.
 *
 * Test-only: no attestation statement, no resident-key storage, no
 * extensions.
 */

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor> | { [key: string]: Cbor };

/** Just enough deterministic CBOR (RFC 8949) for attestation objects and COSE keys. */
function cbor(value: Cbor): Buffer {
  const head = (major: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
    if (n < 0x10000) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(n, 1);
    return b;
  };
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const sha256 = (data: Uint8Array | string): Buffer => createHash('sha256').update(data).digest();

/** UP (0x01) | UV (0x04) | BE (0x08) | BS (0x10): a synced, backed-up passkey. */
const FLAGS_SYNCED = 0x01 | 0x04 | 0x08 | 0x10;
const FLAG_ATTESTED = 0x40;

interface CredentialJSONBase {
  id: string;
  rawId: string;
  type: 'public-key';
  authenticatorAttachment: 'platform';
  clientExtensionResults: Record<string, never>;
}

/** Shape of SimpleWebAuthn's `RegistrationResponseJSON`. */
export interface SoftRegistration extends CredentialJSONBase {
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports: Array<'internal' | 'hybrid'>;
  };
}

/** Shape of SimpleWebAuthn's `AuthenticationResponseJSON`. */
export interface SoftAssertion extends CredentialJSONBase {
  response: { clientDataJSON: string; authenticatorData: string; signature: string };
}

export interface SoftAuthenticatorOptions {
  rpId: string;
  origin: string;
  /** Defaults to the all-zero AAGUID Apple's platform authenticator reports. */
  aaguid?: string;
}

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  private counter = 0;

  constructor(private readonly options: SoftAuthenticatorOptions) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.publicJwk = { x: jwk.x ?? '', y: jwk.y ?? '' };
  }

  get credentialIdB64(): string {
    return b64url(this.credentialId);
  }

  /** The `RegistrationResponseJSON` for `/passkey/generate-register-options`'s challenge. */
  register(challenge: string): SoftRegistration {
    const aaguid = Buffer.from((this.options.aaguid ?? '00000000-0000-0000-0000-000000000000').replace(/-/g, ''), 'hex');
    const coseKey = new Map<Cbor, Cbor>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(this.publicJwk.x, 'base64url')],
      [-3, Buffer.from(this.publicJwk.y, 'base64url')],
    ]);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(this.options.rpId),
      Buffer.from([FLAGS_SYNCED | FLAG_ATTESTED]),
      this.counterBytes(),
      aaguid,
      idLength,
      this.credentialId,
      cbor(coseKey),
    ]);
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge, origin: this.options.origin, crossOrigin: false }),
    );
    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(cbor({ fmt: 'none', attStmt: {}, authData })),
        transports: ['internal', 'hybrid'],
      },
    };
  }

  /** The `AuthenticationResponseJSON` for `/passkey/generate-authenticate-options`'s challenge. */
  assert(challenge: string): SoftAssertion {
    this.counter += 1;
    const authenticatorData = Buffer.concat([
      sha256(this.options.rpId),
      Buffer.from([FLAGS_SYNCED]),
      this.counterBytes(),
    ]);
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge, origin: this.options.origin, crossOrigin: false }),
    );
    // Node's default ECDSA encoding is DER, which is what WebAuthn carries.
    const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), this.privateKey);
    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
      },
    };
  }

  private counterBytes(): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(this.counter);
    return b;
  }
}
