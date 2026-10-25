// Task 9.1 Phase C: the teacher route, role-gated to teachers only. Thin -- `TeacherView` is the
// actual markup; 8.1 replaces or extends it.
import { requireRole, serverDatabase } from '../../src/auth';
import { TeacherView } from './view';

export const dynamic = 'force-dynamic';

export default async function TeacherPage() {
  const principal = await requireRole(['teacher']);
  let changedSincePublish = false;
  try {
    changedSincePublish = await serverDatabase().repos.publish.changedSinceLastPublish({
      teacherId: principal.userId,
    });
  } catch (err) {
    console.error('teacher_page.changed_since_publish_failed', err instanceof Error ? err.name : 'unknown');
  }
  return await TeacherView({ changedSincePublish });
}
