// Task 11.1b Phase B: the live-classes API's barrel, built once and shared by its route files.
// Nothing is opened at import: the route-coverage test and `next build` import this freely.
import { createLiveClassesHandlers } from './routes';
import { createLiveClassesRuntime, realHooks } from './runtime';

const backend = createLiveClassesRuntime(realHooks);

export const liveClassesHandlers = createLiveClassesHandlers(backend, realHooks.log);
