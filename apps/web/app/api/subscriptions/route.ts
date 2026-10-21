// Task 9.3 Phase B: the no-payment package-start route (ROUTE_POLICY `/api/subscriptions`). The
// student is always the session's principal, never a request field (see start.ts).
import { subscriptionHandlers } from '../../../src/subscriptions/start';
import { withRole } from '../../../src/auth';

export const dynamic = 'force-dynamic';

export const POST = withRole(['student'], subscriptionHandlers.start);
