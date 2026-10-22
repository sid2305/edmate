import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Catches hangs, not speed; CI runs every package's tests at once, so the vitest default
    // (5s) is too tight under load (task 0.20).
    testTimeout: 20_000,
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
        // The access filter is 100% (build plan Definition of done; task 5.4).
        'src/access/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        // The calculator sandbox runs model-chosen input (task 5.5).
        'src/tools/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
