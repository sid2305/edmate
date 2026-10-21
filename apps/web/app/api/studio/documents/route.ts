// The upload centre's document list and create (task 8.2). Teachers only (ROUTE_POLICY
// `/api/studio/**`); the teacher is the session's principal, never a request field.
import { withRole } from '../../../../src/auth';
import { studioHandlers } from '../../../../src/studio';

export const dynamic = 'force-dynamic';

export const GET = withRole(['teacher'], studioHandlers.list);
export const POST = withRole(['teacher'], studioHandlers.create);
