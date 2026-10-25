// Task 9.3f: staff look up one teacher by slug, regardless of verification status (12.1b's queue
// GET stays `pending`-only). The handler lives alongside the queue's in handlers.ts and shares its
// backend; the staff id is always the session's principal.
import { serverDatabase, withRole } from '../../../../../src/auth';
import { createStaffVerificationHandlers } from '../handlers';

export const dynamic = 'force-dynamic';

const handlers = createStaffVerificationHandlers({ repos: () => serverDatabase().repos });

export const GET = withRole(['staff'], handlers.lookup);
