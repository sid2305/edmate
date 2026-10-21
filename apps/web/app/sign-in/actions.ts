'use server';
// Task 9.1 Phase B: the sign-in page's one server action, Google only. Email sign-in goes
// through the plain link to 1.4's own `/api/auth/signin`, not a second action here, so its
// CSRF/rate-limit wiring isn't duplicated. `redirectTo: '/'`: the Phase C dispatcher sorts the
// signed-in role out.
import { signIn } from '../../src/auth';

export async function signInWithGoogle(): Promise<void> {
  await signIn('google', { redirectTo: '/' });
}
