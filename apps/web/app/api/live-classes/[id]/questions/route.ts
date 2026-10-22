// Task 11.2b: students only, consent done (ROUTE_POLICY: clearance 'agent'). See handlers.ts.
import { serverDatabase, withRole } from '../../../../../src/auth';
import { chatAgentCandidates } from '../../../../../src/chat/liveChats';
import { createAskQuestionHandlers } from './handlers';

export const dynamic = 'force-dynamic';

/** Wired to the shared auth runtime's database (same memoised pool the other routes use). */
const handlers = createAskQuestionHandlers({
  agents: { owner: (scope) => serverDatabase().repos.agents.owner(scope) },
  classQuestions: {
    submit: (scope, input) => serverDatabase().repos.classQuestions.submit(scope, input),
  },
  candidateAgentIds: () => chatAgentCandidates(process.env),
});

export const POST = withRole(['student'], handlers.post);
