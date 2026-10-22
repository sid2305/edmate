// Task 12.5c: the staff alert inbox (ROUTE_POLICY `/api/staff/**`: GET and POST, staff only). The
// handlers live in handlers.ts; the staff id is always the session's principal.
import { serverDatabase, withRole } from '../../../../src/auth';
import { createStaffAlertHandlers } from './handlers';

export const dynamic = 'force-dynamic';

const handlers = createStaffAlertHandlers({ repos: () => serverDatabase().repos });

export const GET = withRole(['staff'], handlers.list);
export const POST = withRole(['staff'], handlers.acknowledge);
