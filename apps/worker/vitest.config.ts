import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts is the process entrypoint (opens the real Redis connection); not unit-tested.
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
