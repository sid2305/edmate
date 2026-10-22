// The studio document API (task 8.2) over the process's lazily built backend. Nothing is opened at
// import: the route-coverage test and `next build` import the route files freely.
import { serverDatabase } from '../auth';
import { createStudioHandlers } from './routes';
import { createStudioRuntime, realHooks } from './runtime';
import { createStyleCardHandlers } from './styleCardRoutes';
import { createStyleCardRuntime } from './styleCardRuntime';

export const studioHandlers = createStudioHandlers(
  createStudioRuntime(() => process.env, realHooks),
  realHooks.log,
);

// The style card API (task 8.4a): the shared auth runtime's repositories, and a drafter gateway
// built on the first draft (see styleCardRuntime.ts).
export const styleCardHandlers = createStyleCardHandlers(
  createStyleCardRuntime(() => process.env, {
    repos: () => serverDatabase().repos,
    log: realHooks.log,
  }),
  realHooks.log,
);
