// Worker process entrypoint: opens the real Redis connection and runs the no-op worker.
// REDIS_URL comes from the environment (docker/env.example arrives with task 0.2).
import { Redis } from 'ioredis';
import { createNoopWorker } from './worker.js';

const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const worker = createNoopWorker(connection, { autorun: true });

worker.on('error', (error) => {
  console.error('[worker] error:', error.message);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} received, closing`);
  await worker.close();
  await connection.quit();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shutdown(signal).catch((error: unknown) => {
      console.error('[worker] shutdown failed:', error);
      process.exitCode = 1;
    });
  });
}
