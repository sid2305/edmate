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
import { PACKAGES_MAX } from '@edmate/db';
import { expect, test, type Page } from '@playwright/test';
import { signInAsTeacher } from './fixtures';

test.setTimeout(900_000);

const STEP_TIMEOUT = 30_000;
const WALKTHROUGH_BUDGET_MS = 900_000;

function logStep(label: string, startedAt: number): void {
  const now = Date.now();
  console.log(
    `[8.6g walkthrough] ${label}: ${new Date(now).toISOString()} (+${now - startedAt}ms)`,
  );
}

/**
 * 0.20h finding: a persistent local dev database keeps every package this walkthrough has ever
 * created -- `packages.create` never deletes one (versions are immutable, 8.6b) -- so after
 * enough local runs the demo teacher sits at the real, permanent `PACKAGES_MAX` (20) cap for
 * good, and a plain "Create package" click always fails with "You already have the most packages
 * allowed." CI's database is always well under the cap and this always creates, as before. Once
 * at the cap, this edits one of this suite's own older packages instead (`existingPrefix`
 * matches only names this file itself has ever used) and renames it -- editing never touches the
 * count, and no row this run did not create is ever deleted.
 */
async function createOrRenamePackage(
  page: Page,
  options: { presetName: 'Free starter' | 'Full course'; existingPrefix: RegExp; newName: string },
): Promise<void> {
  // Scoped to the package list itself (`listLabel`, messages/en.json): `AppShell`'s own nav is
  // also a `<ul>`/`<li>` list, so an unscoped `getByRole('listitem')` would count its items too.
  const packageItems = page.getByRole('list', { name: 'Your packages' }).getByRole('listitem');
  const atCap = (await packageItems.count()) >= PACKAGES_MAX;
  const existing = packageItems
    .filter({ has: page.getByRole('heading', { level: 3, name: options.existingPrefix }) })
    .first();
  const reuse = atCap && (await existing.count()) > 0;
  if (reuse) {
    await existing.getByRole('button', { name: /^Edit /, exact: false }).click();
  } else {
    await page.getByRole('button', { name: options.presetName, exact: true }).click();
  }
  const nameInput = page.getByLabel('Package name');
  await nameInput.fill('');
  await nameInput.fill(options.newName);
  await page.getByRole('button', { name: reuse ? 'Save' : 'Create package' }).click();
  await expect(page.getByRole('heading', { name: options.newName })).toBeVisible({
    timeout: STEP_TIMEOUT,
  });
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
      await createOrRenamePackage(page, {
        presetName: 'Free starter',
        existingPrefix: /^E2E Starter /,
        newName: firstName,
      });
    });
    logStep('first package created (Free starter)', start);

    await test.step('create the second package from the Full course preset', async () => {
      await createOrRenamePackage(page, {
        presetName: 'Full course',
        existingPrefix: /^E2E Full /,
        newName: secondName,
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
