// A fake Google for sign-in tests (tasks 1.3, 1.7): discovery, JWKS and a token endpoint that issue
// an id_token signed with a test keypair, served through Auth.js's injected fetch. Nothing reaches
// the network (test/setup.ts makes the global fetch reject). Plus a tiny cookie jar.
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';

export const CLIENT_ID = 'test-client-id.apps.example';
export const ISSUER = 'https://accounts.google.com';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** One test keypair per test file, made on first use. */
let keys: Promise<{ privateKey: CryptoKey; jwk: JWK }> | undefined;
function testKeys() {
  keys ??= generateKeyPair('RS256').then(async (pair) => ({
    privateKey: pair.privateKey,
    jwk: { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' },
  }));
  return keys;
}

export interface GoogleUser {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
}

/** A fake Google: discovery, JWKS and a token endpoint that issues an id_token for `user`. */
export function fakeGoogle(state: {
  user: GoogleUser;
  nonce?: string;
  calls: string[];
}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { privateKey, jwk } = await testKeys();
    const url = new URL(input instanceof Request ? input.url : String(input));
    state.calls.push(`${url.origin}${url.pathname}`);
    if (url.href === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/o/oauth2/v2/auth`,
        token_endpoint: TOKEN_URL,
        userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
        jwks_uri: JWKS_URL,
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.href === JWKS_URL) return Response.json({ keys: [jwk] });
    if (url.href === TOKEN_URL) {
      const body = new URLSearchParams(String(init?.body ?? ''));
      if (body.get('code') !== 'good-code' || !body.get('code_verifier')) {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      const idToken = await new SignJWT({
        ...state.user,
        ...(state.nonce ? { nonce: state.nonce } : {}),
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setSubject(state.user.sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      return Response.json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid email profile',
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

/** A tiny cookie jar over Set-Cookie headers. */
export class Jar {
  readonly values = new Map<string, string>();
  readonly raw: string[] = [];
  take(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      this.raw.push(c);
      const [pair] = c.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (value === '' || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) this.values.delete(name);
      else this.values.set(name, value);
    }
  }
  header(): string {
    return [...this.values].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}
