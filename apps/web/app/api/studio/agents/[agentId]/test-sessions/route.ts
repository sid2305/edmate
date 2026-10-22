// Start a test chat (teacher_preview session) on one of the teacher's own agent's packages
// (task 8.5). Teachers only (ROUTE_POLICY `/api/studio/**`); drafts can be previewed.
import { withRole } from '../../../../../../src/auth';
import { testChatHandlers } from '../../../../../../src/studio/testChat';

export const dynamic = 'force-dynamic';

export const POST = withRole(['teacher'], testChatHandlers.startTestSession);
