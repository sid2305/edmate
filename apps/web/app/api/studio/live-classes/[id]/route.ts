// Task 11.1d Phase B: edit or cancel one of the teacher's own scheduled classes (task 11.1).
// Teachers only (ROUTE_POLICY `/api/studio/**`); the teacher is always the session's principal.
import { withRole } from '../../../../../src/auth';
import { liveClassesHandlers } from '../../../../../src/studio/liveClasses';

export const dynamic = 'force-dynamic';

export const PUT = withRole(['teacher'], liveClassesHandlers.update);
export const DELETE = withRole(['teacher'], liveClassesHandlers.cancel);
