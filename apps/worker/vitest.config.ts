import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration suite (test/) waits on real Redis and Postgres.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Process entrypoints open real connections (Redis, S3); their logic lives in tested modules.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/scripts/**'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
