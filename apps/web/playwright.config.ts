// Task 9.4 Phase D: local-only Playwright for the student chat (`apps/web/e2e/chat.spec.ts`).
// Chromium only, against a real `next dev` and a real Postgres (TEST_DATABASE_URL, same compose
// port override the other @edmate/db tests use); the turn stream itself is intercepted with
// `page.route` (fixtures.ts), so no real model call and no Redis dependency for it. Not wired
// into CI (9.7 adds that job); run locally with `corepack pnpm --filter @edmate/web e2e`.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.EDMATE_E2E_PORT ?? 3111);
// `localhost`, not `127.0.0.1`: Next dev's HMR WebSocket only allows same-host origins by
// default (`allowedDevOrigins`), and a blocked, failing HMR socket forces a full-page reload at
// an awkward moment (mid-test), discarding whatever the page was doing.
const BASE_URL = `http://localhost:${PORT}`;
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://edmate:edmate-dev@127.0.0.1:55432/edmate';

export default defineConfig({
  testDir: './e2e',
  // The stack run (task 9.0) has its own config, playwright.stack.config.ts.
  testIgnore: ['stack/**'],
  // Only Playwright specs: without this, the default testMatch also picks up vitest unit tests
  // like e2e/localDatabaseGuard.test.ts, which Playwright then tries to run and crashes on.
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // No `--webpack` here, by design (1.7e, Phase B): `apps/web/package.json`'s `build` script
    // moved to plain `next build` (Turbopack) in 1.7e Phase A, so there's no remaining reason to
    // run this suite's dev server on webpack for parity with the build -- both now default to
    // Turbopack. 9.4a's original trial of `next dev --webpack -p <port>` (Next 16.4) 500s
    // `/api/health`: webpack's dev compile of a target it names `/instrumentation` pulls in
    // `@edmate/queue` -> `bullmq` (via `src/auth/rate-limit.ts`) and separately `packages/db` ->
    // `pg`, and fails resolving `crypto`/`fs` inside each (bullmq's `bun-redis-client.js`, pg's
    // `pg-connection-string`), plus unrelated optional-dependency misses (`pg-native`,
    // `@valkey/valkey-glide`). 1.7e Phase B re-ran this trial and tried the obvious fix
    // (`serverExternalPackages` in `next.config.ts`, see that file's comment) but it didn't clear
    // the crash -- whatever compiles `/instrumentation` doesn't honour that option, unlike the
    // route/page bundles it already works for (`@edmate/content`). A real fix would touch
    // `instrumentation.ts` or `src/auth/*`, both out of 1.7e's scope (see
    // `docs/tasks/1.7e/handoff.md`, Phase B). Turbopack (this line's default `next dev`) serves
    // `/api/health` and every other route fine; kept as the dev default for that reason, not as a
    // placeholder for a webpack fix still to come.
    command: 'node_modules/.bin/next dev -p ' + String(PORT),
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      // Syntactically valid but unreachable on purpose: the queues and the turn limits are only
      // touched by a real turn, and the turn route is always intercepted in this suite (see
      // fixtures.ts). The per-student session-start limit (9.4a) would touch it, so the dev
      // model below swaps it for the in-memory limiter. Decision, handoff `## Decisions`.
      REDIS_URL: 'redis://127.0.0.1:1',
      // The dev model (9.0, D2): honoured only with a local http AUTH_URL, which BASE_URL is. It
      // keeps the session-start limit in memory (see above); no turn runs against it here.
      EDMATE_DEV_MODEL: 'scripted',
      // Never a real key; a turn is never actually run against a provider in this suite.
      EDMATE_ANTHROPIC_API_KEY: 'e2e-not-a-real-key',
      AUTH_SECRET: 'e2e-test-secret-'.padEnd(40, 'x'),
      AUTH_URL: BASE_URL,
      AUTH_GOOGLE_ID: 'e2e-unused',
      AUTH_GOOGLE_SECRET: 'e2e-unused',
    },
  },
});
