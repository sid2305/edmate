// Task 8.6g: the Phase D exit condition deferred from 8.6d ("two packages in under 15 minutes")
// run as a real Playwright walkthrough against a real `next dev` and a real, seeded Postgres
// (same stack as full-flow.spec.ts). Signs in as the seeded demo teacher (fixtures.ts), who
// already has a style card (seed.ts), so the package form renders without the setup step. No
// model or payment call: this page calls no model and the package list/estimate route is the
// real `/api/studio/packages` route over the real seeded database.
//
// Each step logs a `Date.now()` timestamp (console.log, picked up by the Playwright/CI report),
// and the test asserts the whole walkthrough -- both packages created and visible -- finishes
// inside 15 minutes (900_000 ms), generously above what a human or this scripted run takes, to
// catch a gross regression without being a tight, flaky wall-clock bound (lessons.md: "Wall-clock
// bounds fail on shared CI runners").
import { expect, test } from '@playwright/test';
import { signInAsTeacher } from './fixtures';

test.setTimeout(900_000);

const STEP_TIMEOUT = 30_000;
const WALKTHROUGH_BUDGET_MS = 900_000;

function logStep(label: string, startedAt: number): void {
  const now = Date.now();
  console.log(`[8.6g walkthrough] ${label}: ${new Date(now).toISOString()} (+${now - startedAt}ms)`);
}

test('teacher creates two packages from the presets in under 15 minutes', async ({
  browser,
  baseURL,
}) => {
  const start = Date.now();
  logStep('start', start);

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await signInAsTeacher(context, baseURL!);
    logStep('signed in as teacher', start);

    await page.goto('/teacher/packages');
    await expect(page.getByRole('heading', { level: 1, name: 'Packages' })).toBeVisible({
      timeout: STEP_TIMEOUT,
    });
    logStep('opened /teacher/packages', start);

    // Unique names per run: a re-run against a persistent dev database must not match a stale
    // heading from a previous walkthrough (full-flow.spec.ts's same note on unique seeded text).
    const tag = Date.now().toString(36);
    const firstName = `E2E Starter ${tag}`;
    const secondName = `E2E Full ${tag}`;

    await test.step('create the first package from the Free starter preset', async () => {
      await expect(page.getByText('New package')).toBeVisible({ timeout: STEP_TIMEOUT });
      await page.getByRole('button', { name: 'Free starter', exact: true }).click();
      const nameInput = page.getByLabel('Package name');
      await nameInput.fill('');
      await nameInput.fill(firstName);
      await page.getByRole('button', { name: 'Create package' }).click();
      await expect(page.getByRole('heading', { name: firstName })).toBeVisible({
        timeout: STEP_TIMEOUT,
      });
    });
    logStep('first package created (Free starter)', start);

    await test.step('create the second package from the Full course preset', async () => {
      await page.getByRole('button', { name: 'Full course', exact: true }).click();
      const nameInput = page.getByLabel('Package name');
      await nameInput.fill('');
      await nameInput.fill(secondName);
      await page.getByRole('button', { name: 'Create package' }).click();
      await expect(page.getByRole('heading', { name: secondName })).toBeVisible({
        timeout: STEP_TIMEOUT,
      });
    });
    logStep('second package created (Full course)', start);

    await expect(page.getByRole('heading', { name: firstName })).toBeVisible();
    await expect(page.getByRole('heading', { name: secondName })).toBeVisible();

    const totalMs = Date.now() - start;
    logStep('both packages visible, walkthrough complete', start);
    console.log(`[8.6g walkthrough] total: ${totalMs}ms`);
    expect(totalMs).toBeLessThan(WALKTHROUGH_BUDGET_MS);
  } finally {
    await context.close();
  }
});
