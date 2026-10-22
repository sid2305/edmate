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
    // No `--webpack` here (unlike `next build`, next.config.ts): `@edmate/gateway`'s
    // `loadBundledPrices` reads its bundled `prices.yaml` with
    // `readFileSync(new URL('./prices.yaml', import.meta.url), 'utf8')`, and webpack's dev
    // bundling of that server route rewrites `import.meta.url` into something `readFileSync`
    // rejects (`TypeError: ... Received an instance of URL`), 503-ing `POST /api/sessions` on the
    // very first call. Turbopack (the default `next dev`) does not hit this. Fixing the gateway
    // module itself is out of this task's file scope (`packages/gateway`); flagged as a decision
    // and a blocker, not fixed here. Decision, handoff `## Decisions`.
    command: 'node_modules/.bin/next dev -p ' + String(PORT),
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      // Syntactically valid but unreachable on purpose: starting a session never touches the
      // queues or the turn limits (only running a real turn does, and the turn route is always
      // intercepted in this suite -- see fixtures.ts). Decision, handoff `## Decisions`.
      REDIS_URL: 'redis://127.0.0.1:1',
      // Never a real key; a turn is never actually run against a provider in this suite.
      EDMATE_ANTHROPIC_API_KEY: 'e2e-not-a-real-key',
      AUTH_SECRET: 'e2e-test-secret-'.padEnd(40, 'x'),
      AUTH_URL: BASE_URL,
      AUTH_GOOGLE_ID: 'e2e-unused',
      AUTH_GOOGLE_SECRET: 'e2e-unused',
    },
  },
});
