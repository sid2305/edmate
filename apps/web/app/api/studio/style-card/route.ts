// Task 8.4a: read the teacher's newest style card, or save an edited one as a new version
// (ROUTE_POLICY `/api/studio/**`). The teacher is always the session's principal (styleCardRoutes.ts).
import { withRole } from '../../../../src/auth';
import { styleCardHandlers } from '../../../../src/studio';

export const dynamic = 'force-dynamic';

export const GET = withRole(['teacher'], styleCardHandlers.get);
export const PUT = withRole(['teacher'], styleCardHandlers.save);
