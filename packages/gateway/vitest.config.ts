import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Rule 4: no real network. Adapters only ever reach test/helpers/fetch-mock.ts.
    setupFiles: ['test/setup/no-network.ts'],
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
        // Task 2.2: adapters reveal keys and build auth headers, so they are held to the same bar.
        'src/adapters/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
