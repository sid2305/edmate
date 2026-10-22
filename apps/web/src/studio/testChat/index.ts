// The test chat routes' production wiring (task 8.5 Phase B): the auth runtime's database, Redis
// from REDIS_URL, and the real gateway, all opened on the first request (see runtime.ts).
import { serverDatabase } from '../../auth';
import { consoleLog, openRedis } from '../../turn/runtime';
import { createTestChatHandlers } from './routes';
import { createTestChatRuntime } from './runtime';

const log = consoleLog('[testChat]');

export const testChatHandlers = createTestChatHandlers(
  createTestChatRuntime(() => process.env, {
    database: serverDatabase,
    redis: (url) => openRedis(url, log),
    log,
  }),
);

export { createTestChatHandlers, type TestChatBackend, type TestSessionRow } from './routes';
