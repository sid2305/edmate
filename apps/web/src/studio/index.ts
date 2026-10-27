// The studio API (documents: task 8.2; outline: task 8.3) over the process's lazily built
// backend, built once and shared by both handler sets. Nothing is opened at import: the
// route-coverage test and `next build` import the route files freely.
import { serverDatabase } from '../auth';
import { createMistakeProposalHandlers } from './mistakeProposalRoutes';
import { createOutlineHandlers } from './outline';
import { createStudioHandlers } from './routes';
import { createStudioRuntime, realHooks } from './runtime';
import { createStyleCardHandlers } from './styleCardRoutes';
import { createStyleCardRuntime } from './styleCardRuntime';

const backend = createStudioRuntime(() => process.env, realHooks);

export const studioHandlers = createStudioHandlers(backend, realHooks.log);
export const outlineHandlers = createOutlineHandlers(backend, realHooks.log);

// The style card API (task 8.4a): the shared auth runtime's repositories, and a drafter gateway
// built on the first draft (see styleCardRuntime.ts).
export const styleCardHandlers = createStyleCardHandlers(
  createStyleCardRuntime(() => process.env, {
    repos: () => serverDatabase().repos,
    log: realHooks.log,
  }),
  realHooks.log,
);

// Task 6.3a Phase B: the mistake-proposal API, over the shared auth runtime's repositories.
export const mistakeProposalHandlers = createMistakeProposalHandlers(
  { repos: () => serverDatabase().repos },
  realHooks.log,
);
