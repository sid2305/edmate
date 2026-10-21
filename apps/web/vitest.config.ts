import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['app/**/*.test.ts', 'app/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    // No real network: global fetch rejects, and sign-in env is cleared (rule 4).
    setupFiles: ['test/setup.ts'],
    // Node by default (unchanged for the existing `.test.ts` suites; src/auth/**'s 100%-coverage
    // thresholds assume no DOM). The new `.test.tsx` component tests (RTL needs a DOM) opt into
    // jsdom per file with a `// @vitest-environment jsdom` docblock -- vitest 5 dropped the old
    // `environmentMatchGlobs` config option in favour of this per-file override (or `projects`,
    // which would be overkill for two environments in one small app package).
    environment: 'node',
    // next-auth imports `next/server` without an extension, which Node's ESM resolver refuses
    // (next has no exports map); Next's bundler resolves it, and so does Vite when inlined.
    server: { deps: { inline: ['next-auth'] } },
    coverage: {
      provider: 'v8',
      include: ['app/api/**/*.ts', 'src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        'src/auth/**': { lines: 100, functions: 100, statements: 100, branches: 90 },
      },
    },
  },
});
