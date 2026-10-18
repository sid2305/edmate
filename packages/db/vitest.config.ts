import { Socket } from 'node:net';
import { defineConfig } from 'vitest/config';

const DEFAULT_TEST_URL = 'postgres://edmate:edmate-dev@127.0.0.1:55432/edmate';

/** Whether the integration suites will run: always in CI, else when Postgres answers on TCP. */
async function integrationRuns(): Promise<boolean> {
  if (process.env.CI === 'true') return true;
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL);
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1_000, () => done(false));
    socket.once('error', () => done(false));
    socket.connect(Number(url.port || 5432), url.hostname, () => done(true));
  });
}

export default defineConfig(async () => {
  const integration = await integrationRuns();
  return {
    test: {
      include: ['test/**/*.test.ts'],
      // The integration tests create, migrate and drop their own throwaway databases.
      testTimeout: 60_000,
      hookTimeout: 60_000,
      coverage: {
        provider: 'v8' as const,
        include: ['src/**/*.ts'],
        // bin/ is a two-line process entrypoint around cli.ts, which is covered. Repositories are
        // only exercised by the integration suite: without Postgres (local, no Docker) they are left
        // out of coverage instead of failing it; CI always runs the suite and enforces them.
        // The identity store (1.3) is the same: integration-only, enforced at the same level.
        exclude: ['src/bin/**', ...(integration ? [] : ['src/repositories/**', 'src/identity/**'])],
        thresholds: {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
          ...(integration
            ? {
                'src/repositories/**': {
                  lines: 100,
                  functions: 100,
                  branches: 90,
                  statements: 100,
                },
                'src/identity/**': {
                  lines: 100,
                  functions: 100,
                  branches: 90,
                  statements: 100,
                },
              }
            : {}),
        },
      },
    },
  };
});
