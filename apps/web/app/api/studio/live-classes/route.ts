// Task 11.1b: the teacher's live classes API (task 11.1). Teachers only (ROUTE_POLICY
// `/api/studio/**`); the teacher is always the session's principal.
import { withRole } from '../../../../src/auth';
import { liveClassesHandlers } from '../../../../src/studio/liveClasses';

export const dynamic = 'force-dynamic';

export const GET = withRole(['teacher'], liveClassesHandlers.list);
export const POST = withRole(['teacher'], liveClassesHandlers.create);
