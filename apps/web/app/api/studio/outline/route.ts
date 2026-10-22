// The outline editor's read/write route (task 8.3). Teachers only (ROUTE_POLICY
// `/api/studio/**`); the teacher is always the session's principal.
import { withRole } from '../../../../src/auth';
import { outlineHandlers } from '../../../../src/studio';

export const dynamic = 'force-dynamic';

export const GET = withRole(['teacher'], outlineHandlers.get);
export const PUT = withRole(['teacher'], outlineHandlers.put);
