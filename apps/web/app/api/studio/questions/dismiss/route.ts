// Closes one open question only (task 8.9; never its group). Teachers only (ROUTE_POLICY
// `/api/studio/**`); the teacher is always the session's principal.
import { withRole } from '../../../../../src/auth';
import { questionsHandlers } from '../../../../../src/studio/questions';

export const dynamic = 'force-dynamic';

export const POST = withRole(['teacher'], questionsHandlers.dismiss);
