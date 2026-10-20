import { defineConfig } from 'vitest/config';

// A separate vitest project from the default one (vitest.config.ts): the build-smoke test spawns
// the real production server built by `next build --webpack` and makes real HTTP and Postgres
// calls against it (task 1.7b) -- the opposite of the default config's offline, no-fetch setup
// (test/setup.ts, build plan rule 4, which is about model/payment calls, not this). It has no
// coverage requirement: it is one regression check for a bundler bug, not everyday unit coverage.
export default defineConfig({
  test: {
    include: ['test/build-smoke.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
