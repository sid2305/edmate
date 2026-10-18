import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['app/**/*.test.ts', 'src/**/*.test.ts'],
    // No real network: global fetch rejects, and sign-in env is cleared (rule 4).
    setupFiles: ['test/setup.ts'],
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
