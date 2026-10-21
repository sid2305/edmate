// Task 9.1 Phase C: the teacher route, role-gated to teachers only. Thin -- `TeacherView` is the
// actual markup; 8.1 replaces or extends it.
import { requireRole } from '../../src/auth';
import { TeacherView } from './view';

export const dynamic = 'force-dynamic';

export default async function TeacherPage() {
  await requireRole(['teacher']);
  return <TeacherView />;
}
