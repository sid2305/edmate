// Task 1.4b: the confirm button's Server Action (Next checks its Origin, the CSRF protection). It
// returns the real Auth.js callback URL rather than calling `redirect()`: Next answers a fetch
// action's same-host redirect by fetching the target on the server first, which would spend the
// single-use token there and drop the session cookie.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const confirmUrl = vi.fn<(fields: unknown) => string | null>();
vi.mock('../../../src/auth', () => ({
  confirmEmailSignIn: (fields: unknown) => confirmUrl(fields),
  SIGN_IN_PATH: '/sign-in',
}));

import { confirmEmailSignIn } from './actions';

const TOKEN = 'ab'.repeat(32);

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => confirmUrl.mockReset());

describe('confirmEmailSignIn (server action)', () => {
  it('hands the three fields to src/auth and returns its callback URL', async () => {
    confirmUrl.mockReturnValue('http://localhost:8080/api/auth/callback/email?token=x');
    const url = await confirmEmailSignIn(
      null,
      form({ token: TOKEN, email: 'a@example.test', callbackUrl: '/', extra: 'ignored' }),
    );
    expect(url).toBe('http://localhost:8080/api/auth/callback/email?token=x');
    expect(confirmUrl).toHaveBeenCalledWith({ token: TOKEN, email: 'a@example.test', callbackUrl: '/' });
  });

  it('missing fields reach src/auth as null (it refuses them)', async () => {
    confirmUrl.mockReturnValue(null);
    await confirmEmailSignIn(null, form({}));
    expect(confirmUrl).toHaveBeenCalledWith({ token: null, email: null, callbackUrl: null });
  });

  it('an invalid submission goes back to the sign-in page', async () => {
    confirmUrl.mockReturnValue(null);
    expect(await confirmEmailSignIn('stale', form({ token: 'nope' }))).toBe('/sign-in');
  });
});
