// Task 8.1a: the onboarding form's create/edit route (ROUTE_POLICY `/api/studio/**`). The teacher
// is always the session's principal, never a request field (see profile.ts).
import { withRole } from '../../../../src/auth';
import { profileHandlers } from '../../../../src/studio/profile';

export const dynamic = 'force-dynamic';

export const POST = withRole(['teacher'], profileHandlers.create);
export const PUT = withRole(['teacher'], profileHandlers.update);
