import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `test/build-smoke.test.ts` has its own config (vitest.build-smoke.config.ts, 3.10a review
    // item 2) and must not also run here: it spawns a real child process against real compiled
    // output, the opposite of this config's offline unit tests.
    exclude: ['**/node_modules/**', 'test/build-smoke.test.ts'],
    // Rule 4: no real network, even from `edmate eval --record` code paths.
    setupFiles: ['test/setup/no-network.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
