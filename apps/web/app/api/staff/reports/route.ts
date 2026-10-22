// Task 12.2d: the staff report queue (ROUTE_POLICY `/api/staff/**`: GET and POST, staff only). The
// handlers live in handlers.ts; the staff id is always the session's principal.
import { serverDatabase, withRole } from '../../../../src/auth';
import { createStaffReportsHandlers } from './handlers';

export const dynamic = 'force-dynamic';

const handlers = createStaffReportsHandlers({ repos: () => serverDatabase().repos });

export const GET = withRole(['staff'], handlers.list);
export const POST = withRole(['staff'], handlers.review);
