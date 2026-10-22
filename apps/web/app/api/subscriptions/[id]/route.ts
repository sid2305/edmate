// Task 9.6 Phase D: upgrade, downgrade, switch, pause, resume and cancel (`ROUTE_POLICY`'s
// existing `PATCH /api/subscriptions/*` row -- no auth change needed).
import { withRole } from '../../../../src/auth';
import { planHandlers } from '../../../../src/subscriptions/change';

export const dynamic = 'force-dynamic';

export const PATCH = withRole(['student'], planHandlers.patch);
