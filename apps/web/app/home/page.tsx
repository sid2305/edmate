// Task 9.1 Phase C: the student home route. Thin -- `requireRole` gates it, `HomeView` is the
// actual markup (kept pure so it can be tested directly, no server-only guard to stub).
import { requireRole } from '../../src/auth';
import { HomeView } from './view';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  await requireRole(['student']);
  return <HomeView />;
}
