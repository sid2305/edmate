// Task 8.2f (Phase C of 8.2b): add a web link in the upload centre. Teachers only (ROUTE_POLICY
// `/api/studio/**`); the teacher is the session's principal, never a request field.
import { withRole } from '../../../../src/auth';
import { studioHandlers } from '../../../../src/studio';

export const dynamic = 'force-dynamic';

export const POST = withRole(['teacher'], studioHandlers.addLink);
