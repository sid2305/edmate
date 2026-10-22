// The studio API (documents: task 8.2; outline: task 8.3) over the process's lazily built
// backend, built once and shared by both handler sets. Nothing is opened at import: the
// route-coverage test and `next build` import the route files freely.
import { createOutlineHandlers } from './outline';
import { createStudioHandlers } from './routes';
import { createStudioRuntime, realHooks } from './runtime';

const backend = createStudioRuntime(() => process.env, realHooks);

export const studioHandlers = createStudioHandlers(backend, realHooks.log);
export const outlineHandlers = createOutlineHandlers(backend, realHooks.log);
