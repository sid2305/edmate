import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/pedagogy/testing.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        // The teaching policy decides locked, uncovered and distress replies (task 3.5).
        'src/pedagogy/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        // Guard logic is 100% (build plan Definition of done; task 4.1).
        'src/guardrails/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
