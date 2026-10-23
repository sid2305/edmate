'use server';
// Task 1.4b: the confirm page's one click, a Server Action (Next checks its Origin: the CSRF
// protection). It returns the real Auth.js callback URL for the client to open as a full page
// rather than calling `redirect()`: Next answers a fetch action's same-host redirect by fetching
// the target on the server first, which would spend the single-use token there and drop the
// session cookie it sets.
import { confirmEmailSignIn as callbackUrlFor, SIGN_IN_PATH } from '../../../src/auth';

export async function confirmEmailSignIn(_previous: string | null, form: FormData): Promise<string> {
  // src/auth also sets the short-lived "confirmed" cookie the callback route requires.
  const url = await callbackUrlFor({
    token: form.get('token'),
    email: form.get('email'),
    callbackUrl: form.get('callbackUrl'),
  });
  return url ?? SIGN_IN_PATH;
}
