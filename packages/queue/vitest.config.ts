import { Socket } from 'node:net';
import { defineConfig } from 'vitest/config';

const DEFAULT_TEST_REDIS_URL = 'redis://127.0.0.1:56379';

/** Whether the Redis integration suite will run: always in CI, else when Redis answers on TCP. */
async function integrationRuns(): Promise<boolean> {
  if (process.env.CI === 'true') return true;
  const url = new URL(process.env.TEST_REDIS_URL ?? DEFAULT_TEST_REDIS_URL);
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1_000, () => done(false));
    socket.once('error', () => done(false));
    socket.connect(Number(url.port || 6379), url.hostname, () => done(true));
  });
}

export default defineConfig(async () => {
  const integration = await integrationRuns();
  return {
    test: {
      include: ['test/**/*.test.ts'],
      // turnLimits.int.test.ts waits on real Redis; its own tests set explicit per-test timeouts.
      testTimeout: 10_000,
      hookTimeout: 10_000,
      coverage: {
        provider: 'v8' as const,
        include: ['src/**/*.ts'],
        // turnLimits.ts (task 3.14) is only exercised by the Redis integration suite: without
        // Redis (local, no Docker) it is left out of coverage instead of failing it; CI always
        // runs the suite and enforces it at 100%, the same convention packages/db uses for its
        // repositories.
        exclude: integration ? [] : ['src/turnLimits.ts'],
        thresholds: {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
      },
    },
  };
});
