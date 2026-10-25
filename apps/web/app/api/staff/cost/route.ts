// Task 13.5 Phase B: the staff cost dashboard (ROUTE_POLICY `/api/staff/**`: GET, staff only).
// The handler lives in handlers.ts.
import { serverDatabase, withRole } from '../../../../src/auth';
import { createStaffCostHandlers } from './handlers';

export const dynamic = 'force-dynamic';

const handlers = createStaffCostHandlers({ repos: () => serverDatabase().repos });

export const GET = withRole(['staff'], handlers.list);
