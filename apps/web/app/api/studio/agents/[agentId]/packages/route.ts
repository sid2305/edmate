// The packages a teacher can test-chat with for one of their own agents (task 8.5). Teachers only
// (ROUTE_POLICY `/api/studio/**`).
import { withRole } from '../../../../../../src/auth';
import { testChatHandlers } from '../../../../../../src/studio/testChat';

export const dynamic = 'force-dynamic';

export const GET = withRole(['teacher'], testChatHandlers.listPackages);
