// Task 8.7 Phase D: start a publish (the quality gate runs on the worker) and read the latest
// gate run (ROUTE_POLICY `/api/studio/**`). The teacher is always the session's principal; the
// body is a strict `{}` (see src/studio/publish.ts).
import { withRole } from '../../../../src/auth';
import { publishHandlers } from '../../../../src/studio/publishRuntime';

export const dynamic = 'force-dynamic';

export const GET = withRole(['teacher'], publishHandlers.latest);
export const POST = withRole(['teacher'], publishHandlers.start);
