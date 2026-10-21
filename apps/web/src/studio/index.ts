// The studio document API (task 8.2) over the process's lazily built backend. Nothing is opened at
// import: the route-coverage test and `next build` import the route files freely.
import { createStudioHandlers } from './routes';
import { createStudioRuntime, realHooks } from './runtime';

export const studioHandlers = createStudioHandlers(
  createStudioRuntime(() => process.env, realHooks),
  realHooks.log,
);
