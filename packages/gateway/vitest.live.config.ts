// `pnpm --filter @edmate/gateway test:live`: the `--live` smoke tests (build plan rule 4). They make
// real provider calls with keys from the environment, so they never run in `test` or CI.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.live.smoke.test.ts'],
    testTimeout: 120_000,
  },
});
