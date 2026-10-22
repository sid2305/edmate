// The teacher questions inbox's list route (task 8.9). Teachers only (ROUTE_POLICY
// `/api/studio/**`); the teacher is always the session's principal.
import { withRole } from '../../../../src/auth';
import { questionsHandlers } from '../../../../src/studio/questions';

export const dynamic = 'force-dynamic';

export const GET = withRole(['teacher'], questionsHandlers.list);
