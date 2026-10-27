// Task 6.3a Phase B: a teacher's proposed mistake tags — list, approve or reject
// (ROUTE_POLICY `/api/studio/**`). The teacher is always the session's principal
// (mistakeProposalRoutes.ts). POST (not PATCH, see mistakeProposalRoutes.ts) carries both
// decisions, `{ tag, action }`.
import { withRole } from '../../../../src/auth';
import { mistakeProposalHandlers } from '../../../../src/studio';

export const dynamic = 'force-dynamic';

export const GET = withRole(['teacher'], mistakeProposalHandlers.list);
export const POST = withRole(['teacher'], mistakeProposalHandlers.decide);
