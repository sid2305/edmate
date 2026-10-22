// Task 9.1 Phase C / 9.2 Q3: `/` is a pure dispatcher, not a landing page. It reads who, if
// anyone, is signed in and sends them straight to their place: a student to `/home`, a teacher to
// `/teacher`, staff to sign-in (no staff console exists yet -- 12.1's staff console is a separate
// task, logged as a decision, not a blocker), and an anonymous visitor to `/teachers` (9.2's
// public discovery page is the MVP landing page; a marketing page comes with the launch phase).
import { redirect } from 'next/navigation';
import { currentPrincipal, SIGN_IN_PATH } from '../src/auth';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const principal = await currentPrincipal();
  if (principal?.role === 'student') redirect('/home');
  if (principal?.role === 'teacher') redirect('/teacher');
  if (principal?.role === 'staff') redirect(SIGN_IN_PATH);
  redirect('/teachers');
}
