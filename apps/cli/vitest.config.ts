import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
