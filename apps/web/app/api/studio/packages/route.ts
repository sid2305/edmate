// Task 8.6 Phase C: a teacher's packages with their AI-cost estimates: list, create, save a new
// version (ROUTE_POLICY `/api/studio/**`). The teacher is always the session's principal and the
// agent id always comes from the repos, never the body (see src/studio/packages.ts).
import { withRole } from '../../../../src/auth';
import { packageHandlers } from '../../../../src/studio/packagesRuntime';

export const dynamic = 'force-dynamic';

export const GET = withRole(['teacher'], packageHandlers.list);
export const POST = withRole(['teacher'], packageHandlers.create);
export const PUT = withRole(['teacher'], packageHandlers.update);
