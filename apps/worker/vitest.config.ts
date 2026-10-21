import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration suite (test/) waits on real Redis and Postgres.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The int tests race real wall-clock budgets inside the harness (guard chain slices, classifier
    // timeouts) against real Redis/Postgres and BullMQ workers. Running this package's test files
    // one at a time (not across several worker threads) keeps CI's shared runner from starving one
    // file's real timers while another's heavy integration test (e.g. alert.int.test.ts's retries)
    // runs at the same time, which was flaking safetyEvent.int.test.ts in CI (task 4.4 CI fix).
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Process entrypoints open real connections (Redis, S3); their logic lives in tested modules.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/scripts/**'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
