// A student's notes PDF: progress, next steps, session summaries, the teacher's answers and
// mistakes to watch (task 9.6 Phase B). Falls under the existing `/api/me/**` GET policy row.
import { withRole } from '../../../../../../src/auth';
import { exportHandlers } from '../../../../../../src/export/routes';

export const dynamic = 'force-dynamic';

export const GET = withRole(['student'], exportHandlers.notes);
