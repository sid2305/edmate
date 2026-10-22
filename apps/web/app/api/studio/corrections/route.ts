// Correct a wrong test chat answer (task 8.5): a corrections row, a teacher-note chunk and an eval
// case, in the signed-in teacher's scope. Teachers only (ROUTE_POLICY `/api/studio/**`).
import { withRole } from '../../../../src/auth';
import { testChatHandlers } from '../../../../src/studio/testChat';

export const dynamic = 'force-dynamic';

export const POST = withRole(['teacher'], testChatHandlers.postCorrection);
