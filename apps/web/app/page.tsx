// Task 9.1 Phase C: `/` is a pure dispatcher, not a landing page (9.2 builds that). It reads who,
// if anyone, is signed in and sends them straight to their place: anonymous or staff (no staff
// console exists yet -- 12.1's staff console is a separate task, logged as a decision, not a
// blocker) to sign-in, a student to `/home`, a teacher to `/teacher`.
import { redirect } from 'next/navigation';
import { currentPrincipal, SIGN_IN_PATH } from '../src/auth';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const principal = await currentPrincipal();
  if (principal?.role === 'student') redirect('/home');
  if (principal?.role === 'teacher') redirect('/teacher');
  redirect(SIGN_IN_PATH);
}
