// Task 9.0 Phase C: the try-it flow against a running local compose stack (docker/compose.yaml),
// through Caddy. Opt-in and local only (decision D5): not in CI, because it needs the stack up.
// No webServer and no globalSetup: the stack is already running and seeded (docs/try-it.md).
//   EDMATE_STACK_URL=http://localhost:8080 corepack pnpm --filter @edmate/web e2e:stack
import { defineConfig, devices } from '@playwright/test';
import { localUrl } from './e2e/stack/mail';

const BASE_URL = localUrl(process.env.EDMATE_STACK_URL ?? 'http://localhost:8080').origin;

export default defineConfig({
  testDir: './e2e/stack',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  // One test walks the whole flow: image-cold first requests, a 4 s upload poll and a chat turn.
  timeout: 300_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
