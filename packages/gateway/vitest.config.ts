import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        // Task 2.1: the key module is the only door for provider keys, so every line is tested.
        'src/keys/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
