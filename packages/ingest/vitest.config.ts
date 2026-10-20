import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Rule 4: no real network. Web-link tests only ever reach an injected fake fetch and resolver.
    setupFiles: ['test/setup/no-network.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        // Task 5.1: the web fetch is the only door to the outside world (SSRF), so all of it is tested.
        'src/fetch/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
