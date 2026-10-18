import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['app/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['app/api/**/*.ts'],
      exclude: ['app/**/*.test.ts'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
