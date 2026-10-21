// The chat routes' production wiring (task 9.4): the auth runtime's database, Redis from
// REDIS_URL, and the real gateway, all opened on the first request (see runtime.ts).
import { serverDatabase } from '../auth';
import { createSessionHandlers } from './routes';
import { consoleLog, createTurnRuntime, openRedis } from './runtime';

const log = consoleLog('[turn]');

export const sessionHandlers = createSessionHandlers(
  createTurnRuntime(() => process.env, {
    database: serverDatabase,
    redis: (url) => openRedis(url, log),
    log,
  }),
);
