import { describe, expect, it } from 'vitest';
import { AuthConfigError, readAuthEnv } from './env';

const SECRET = 'test-only-'.padEnd(40, 'x');
const GOOD = {
  AUTH_SECRET: SECRET,
  AUTH_URL: 'http://localhost:8080',
  AUTH_GOOGLE_ID: 'test-client.apps.example',
  AUTH_GOOGLE_SECRET: 'test-google-client-secret-value',
};
// Built at runtime from obviously fake parts: an SMTP URL holds a password.
const SMTP_PASS = ['fake', 'smtp', 'pass'].join('-');
const SMTP = `smtp://user:${SMTP_PASS}@smtp.example.test:587`;
const EMAIL = {
  EMAIL_SERVER: SMTP,
  EMAIL_FROM: 'Edmate <sign-in@example.test>',
  REDIS_URL: 'redis://127.0.0.1:6379',
};
const NO_GOOGLE = { AUTH_SECRET: SECRET, AUTH_URL: 'http://localhost:8080' };

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
      google: { id: GOOD.AUTH_GOOGLE_ID, secret: GOOD.AUTH_GOOGLE_SECRET },
      trustHost: false,
      secureCookies: false,
    });
    expect(env.email).toBeUndefined();
    expect(env.url.origin).toBe('http://localhost:8080');
  });

  it('https turns on secure cookies; AUTH_TRUST_HOST true or 1 trusts the host', () => {
    expect(readAuthEnv({ ...GOOD, AUTH_URL: 'https://edmate.example' }).secureCookies).toBe(true);
    expect(readAuthEnv({ ...GOOD, AUTH_TRUST_HOST: ' TRUE ' }).trustHost).toBe(true);
    expect(readAuthEnv({ ...GOOD, AUTH_TRUST_HOST: '1' }).trustHost).toBe(true);
    expect(readAuthEnv({ ...GOOD, AUTH_TRUST_HOST: 'yes' }).trustHost).toBe(false);
  });

  it('email only (no Google): email settings and REDIS_URL are read', () => {
    const env = readAuthEnv({ ...NO_GOOGLE, ...EMAIL, AUTH_GOOGLE_ID: '', AUTH_GOOGLE_SECRET: ' ' });
    expect(env.google).toBeUndefined();
    expect(env.email).toEqual({ server: SMTP, from: EMAIL.EMAIL_FROM, redisUrl: EMAIL.REDIS_URL });
  });

  it('both providers together; smtps is accepted', () => {
    const env = readAuthEnv({ ...GOOD, ...EMAIL, EMAIL_SERVER: 'smtps://smtp.example.test:465' });
    expect(env.google).toBeDefined();
    expect(env.email?.server).toBe('smtps://smtp.example.test:465');
  });

  it('REDIS_URL alone does not turn on email', () => {
    expect(readAuthEnv({ ...GOOD, REDIS_URL: EMAIL.REDIS_URL }).email).toBeUndefined();
  });

  it.each([
    ['AUTH_SECRET', undefined, 'AUTH_SECRET is not set'],
    ['AUTH_SECRET', '   ', 'AUTH_SECRET is not set'],
    ['AUTH_SECRET', 'short-secret-value', 'AUTH_SECRET must be at least 32 characters'],
    ['AUTH_URL', undefined, 'AUTH_URL is not set'],
    ['AUTH_URL', 'not a url', 'AUTH_URL must be an http or https URL'],
    ['AUTH_URL', 'ftp://files.example', 'AUTH_URL must be an http or https URL'],
    ['AUTH_GOOGLE_ID', undefined, 'AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET must be set together'],
    ['AUTH_GOOGLE_SECRET', '', 'AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET must be set together'],
  ])('%s=%j fails naming the variable, never the value', (name, value, message) => {
    const err = failure({ ...GOOD, [name]: value });
    expect(err.message).toBe(message);
    for (const v of [...Object.values(GOOD), value].filter((x) => x && x.trim().length > 3)) {
      expect(err.message).not.toContain(v);
    }
  });

  it.each([
    [{ EMAIL_FROM: undefined }, 'EMAIL_SERVER and EMAIL_FROM must be set together'],
    [{ EMAIL_SERVER: '' }, 'EMAIL_SERVER and EMAIL_FROM must be set together'],
    [{ EMAIL_SERVER: `http://user:${SMTP_PASS}@smtp.example.test` }, 'EMAIL_SERVER must be an smtp or smtps URL'],
    [{ EMAIL_SERVER: `user:${SMTP_PASS}@smtp.example.test` }, 'EMAIL_SERVER must be an smtp or smtps URL'],
    [{ REDIS_URL: undefined }, 'REDIS_URL is not set (email sign-in needs it for rate limits)'],
    [{ REDIS_URL: 'not a url' }, 'REDIS_URL must be a redis or rediss URL'],
  ])('email settings %j fail without echoing a value', (over, message) => {
    const err = failure({ ...GOOD, ...EMAIL, ...over });
    expect(err.message).toBe(message);
    for (const v of [SMTP, SMTP_PASS, EMAIL.EMAIL_FROM, EMAIL.REDIS_URL, ...Object.values(over)]) {
      if (v) expect(err.message).not.toContain(v);
    }
  });

  it('no provider at all is an AuthConfigError', () => {
    expect(failure(NO_GOOGLE).message).toBe(
      'no sign-in provider: set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, or EMAIL_SERVER and EMAIL_FROM',
    );
  });
});
