// One chat turn as server-sent events (task 9.4). Students only, consent done
// (ROUTE_POLICY: clearance 'agent').
import { withRole } from '../../../../../src/auth';
import { sessionHandlers } from '../../../../../src/turn';

export const dynamic = 'force-dynamic';

export const POST = withRole(['student'], sessionHandlers.postTurn);
