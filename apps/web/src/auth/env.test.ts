import { describe, expect, it } from 'vitest';
import { AuthConfigError, readAuthEnv } from './env';

const SECRET = 'test-only-'.padEnd(40, 'x');
const GOOD = {
  AUTH_SECRET: SECRET,
  AUTH_URL: 'http://localhost:8080',
  AUTH_GOOGLE_ID: 'test-client.apps.example',
  AUTH_GOOGLE_SECRET: 'test-google-client-secret-value',
};

function failure(env: Record<string, string | undefined>): AuthConfigError {
  try {
    readAuthEnv(env);
  } catch (e) {
    expect(e).toBeInstanceOf(AuthConfigError);
    return e as AuthConfigError;
  }
  throw new Error('readAuthEnv accepted it');
}

describe('readAuthEnv', () => {
  it('reads the settings; http means no secure cookies and host not trusted by default', () => {
    const env = readAuthEnv(GOOD);
    expect(env).toMatchObject({
      secret: SECRET,
      googleId: GOOD.AUTH_GOOGLE_ID,
      googleSecret: GOOD.AUTH_GOOGLE_SECRET,
      trustHost: false,
      secureCookies: false,
    });
    expect(env.url.origin).toBe('http://localhost:8080');
  });

  it('https turns on secure cookies; AUTH_TRUST_HOST true or 1 trusts the host', () => {
    expect(readAuthEnv({ ...GOOD, AUTH_URL: 'https://edmate.example' }).secureCookies).toBe(true);
    expect(readAuthEnv({ ...GOOD, AUTH_TRUST_HOST: ' TRUE ' }).trustHost).toBe(true);
    expect(readAuthEnv({ ...GOOD, AUTH_TRUST_HOST: '1' }).trustHost).toBe(true);
    expect(readAuthEnv({ ...GOOD, AUTH_TRUST_HOST: 'yes' }).trustHost).toBe(false);
  });

  it.each([
    ['AUTH_SECRET', undefined, 'AUTH_SECRET is not set'],
    ['AUTH_SECRET', '   ', 'AUTH_SECRET is not set'],
    ['AUTH_SECRET', 'short-secret-value', 'AUTH_SECRET must be at least 32 characters'],
    ['AUTH_URL', undefined, 'AUTH_URL is not set'],
    ['AUTH_URL', 'not a url', 'AUTH_URL must be an http or https URL'],
    ['AUTH_URL', 'ftp://files.example', 'AUTH_URL must be an http or https URL'],
    ['AUTH_GOOGLE_ID', undefined, 'AUTH_GOOGLE_ID is not set'],
    ['AUTH_GOOGLE_SECRET', '', 'AUTH_GOOGLE_SECRET is not set'],
  ])('%s=%j fails naming the variable, never the value', (name, value, message) => {
    const err = failure({ ...GOOD, [name]: value });
    expect(err.message).toBe(message);
    for (const v of [...Object.values(GOOD), value].filter((x) => x && x.trim().length > 3)) {
      expect(err.message).not.toContain(v);
    }
  });
});
