// Task 12.3d: the repeat-infringer flag (B-63), ROUTE_POLICY `/api/staff/**`, staff only. GET
// only -- a staff user suspends through the existing `/api/staff/verifications` POST, unchanged.
import { serverDatabase, withRole } from '../../../../src/auth';
import { createStaffRepeatInfringersHandlers } from './handlers';

export const dynamic = 'force-dynamic';

const handlers = createStaffRepeatInfringersHandlers({ repos: () => serverDatabase().repos });

export const GET = withRole(['staff'], handlers.list);
