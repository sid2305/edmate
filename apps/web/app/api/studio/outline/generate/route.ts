// Drafts an outline from the teacher's ready chunks and saves it (task 8.3). Teachers only
// (ROUTE_POLICY `/api/studio/**`); the teacher is always the session's principal.
import { withRole } from '../../../../../src/auth';
import { outlineHandlers } from '../../../../../src/studio';

export const dynamic = 'force-dynamic';

export const POST = withRole(['teacher'], outlineHandlers.generate);
