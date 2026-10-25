// Task 13.1: axe accessibility checks against the main public, student and teacher pages, run
// inside the existing `e2e` CI job (same `next dev` + real seeded Postgres as full-flow.spec.ts,
// fixtures.ts). Signed-in cases reuse fixtures.ts's real, database-backed session helper
// (`identity.createSession`, not a test-only auth shortcut). The accept line is "no serious
// violations": each case asserts zero violations of `serious`/`critical` impact against
// `wcag2a`/`wcag2aa`/`wcag21aa`/`wcag22aa`, and logs (never fails on) `minor`/`moderate` findings
// so they are visible without blocking the PR (board follow-up instead of a silent drop).
//
// Out of bounds for this task: `app/teacher/live-classes/**` (another builder's worktree, both
// as files and as route coverage) -- `/teacher` itself is covered, its `live-classes` sub-pages
// are not.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_TEACHER, signInAsStudent, signInAsTeacher } from './fixtures';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

/** Runs axe against `page` with the task's WCAG tag set, logs any `minor`/`moderate` findings
 * (console.log, picked up by the Playwright/CI report -- a board follow-up, not a silent drop),
 * then asserts no violation has `impact` of `'serious'` or `'critical'` (the accept line,
 * verbatim). */
async function expectNoSeriousViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const lesser = results.violations.filter(
    (v) => v.impact === 'minor' || v.impact === 'moderate',
  );
  for (const violation of lesser) {
    console.log(`[a11y.spec.ts] ${label}: ${violation.impact} — ${violation.id} (${violation.nodes.length} node(s))`);
  }
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious, `${label}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
}

test.describe('accessibility (axe, no serious violations)', () => {
  test('public: home (/)', async ({ page, baseURL }) => {
    await page.goto(baseURL!);
    await expectNoSeriousViolations(page, '/');
  });

  test('public: sign-in (/sign-in)', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/sign-in`);
    await expectNoSeriousViolations(page, '/sign-in');
  });

  test('student, signed in: /home', async ({ page, context, baseURL }) => {
    await signInAsStudent(context, baseURL!);
    await page.goto(`${baseURL}/home`);
    await expect(page).toHaveURL(/\/home(?:[/?#]|$)/);
    await expectNoSeriousViolations(page, '/home (student)');
  });

  test('teacher, signed in: /teacher', async ({ page, context, baseURL }) => {
    await signInAsTeacher(context, baseURL!, DEMO_TEACHER);
    await page.goto(`${baseURL}/teacher`);
    await expect(page).toHaveURL(/\/teacher(?:[/?#]|$)/);
    await expectNoSeriousViolations(page, '/teacher');
  });
});
