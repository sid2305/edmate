import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Live sandbox tests reach a real provider: only `pnpm test:live` runs them.
    exclude: [...configDefaults.exclude, 'test/**/*.live.test.ts'],
    // Rule 4: no real network. Any fetch or socket in a test fails loudly.
    setupFiles: ['test/setup/no-network.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        // Task 10.1b: signature checks, the market-to-provider choice, the error contract and the
        // fake that later M10 tests rely on are tested in full.
        'src/webhook/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/registry.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/errors.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/testing/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
