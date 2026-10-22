// Task 12.2c: POST /api/sessions/:id/reports (ROUTE_POLICY `/api/sessions/**`, student, clearance
// 'agent'). The handler lives in handlers.ts; the student id is always the session's principal.
import { serverDatabase, withRole } from '../../../../../src/auth';
import { createSessionReportsHandlers } from './handlers';

export const dynamic = 'force-dynamic';

const handlers = createSessionReportsHandlers({
  agents: { owner: (scope) => serverDatabase().repos.agents.owner(scope) },
  repos: () => serverDatabase().repos,
});

export const POST = withRole(['student'], handlers.file);
