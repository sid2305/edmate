import { defineConfig } from 'vitest/config';

// A separate vitest project from the default one (vitest.config.ts), same pattern as
// apps/web/vitest.build-smoke.config.ts: this spawns a real `node` child process against the
// real compiled `dist/` (this package's own, and @edmate/content's), the opposite of the default
// config's offline, no-network unit-test setup. No coverage requirement: it is one regression
// check for the safe-regex guard's fail-closed behaviour (3.10a review item 2), not everyday
// unit coverage.
export default defineConfig({
  test: {
    include: ['test/build-smoke.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
