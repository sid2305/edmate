// `pnpm --filter @edmate/payments test:live`: provider sandbox runs (build plan rule 4). They make
// real calls with keys from the environment, so only the human runs them, never `test` or CI.
// There are no live tests until a real adapter lands (10.1c).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.live.test.ts'],
    passWithNoTests: true,
    testTimeout: 120_000,
  },
});
