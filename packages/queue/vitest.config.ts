import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Every enqueue decides whether a write is durable and where the answer key goes (task 3.8).
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
