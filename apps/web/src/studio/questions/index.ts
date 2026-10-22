// Task 8.9 Phase B: the questions inbox API's barrel, built once and shared by its route files.
// Nothing is opened at import: the route-coverage test and `next build` import this freely.
import { createQuestionsHandlers } from './routes';
import { createQuestionsRuntime, realHooks } from './runtime';

const backend = createQuestionsRuntime(realHooks);

export const questionsHandlers = createQuestionsHandlers(backend, realHooks.log);
