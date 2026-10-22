// One test chat turn as server-sent events (task 8.5): the student turn's pipeline with the
// teacher as the student. Teachers only (ROUTE_POLICY `/api/studio/**`).
import { withRole } from '../../../../../../src/auth';
import { testChatHandlers } from '../../../../../../src/studio/testChat';

export const dynamic = 'force-dynamic';

export const POST = withRole(['teacher'], testChatHandlers.postTestTurn);
