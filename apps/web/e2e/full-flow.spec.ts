// Task 9.7 Phase A: one student and one teacher, end to end, against a real `next dev` and a
// real Postgres (same stack as chat.spec.ts). No step calls a real model or a real payment
// provider: every model-shaped answer is a `page.route`-intercepted SSE fixture (fixtures.ts's
// `sseBody`/`mockTurns`), and subscribing a paid package needs no payment (CLAUDE.md: a paid
// package starts as an active subscription until M10). Every other step -- sign-in, subscribing,
// the teacher's questions inbox and answer -- is the real route over the real seeded Postgres.
//
// Phase B (9.7b) adds the two stages Phase A could not reach: discovery (start at `/teachers`,
// search, open `/teachers/demo-teacher`, follow its link to `/packages/demo-agent`) and the
// upgrade (the plan page's real Upgrade PATCH, which lands on `/learn/demo-agent` with no `?s=`, a
// fresh session on the paid package, where one more message gets no locked notice). The upgrade
// is the real 9.6 route over the real subscription row; only the chat replies are mocked. The
// "uncovered question" is seeded
// directly through the real `teacherQuestions.open` repository (plan's open question 3): the
// student's chat turns stay fully mocked, but the question/answer state is always real.
//
// Next dev compiles each route on its first visit; on a loaded CI/dev box that first compile can
// outlast a plain click/fill, which would otherwise race hydration (the server-rendered control
// is visible, and actionable, before React attaches its listeners, so an early click is a no-op).
// `postOnce` therefore retries only until the action's own POST has left the browser, never after:
// the turns route hands out single-use fixtures in a fixed order and the Start button posts a real
// subscription, so a second POST would desync the flow. Each outcome is then awaited on its own
// with Playwright's expect timeout -- the action is never repeated.
import type { TurnEvent } from '@edmate/contracts';
import { openDatabase } from '@edmate/db';
import { expect, test, type Page, type Request } from '@playwright/test';
import {
  DEMO_AGENT,
  DEMO_TEACHER,
  mockTurns,
  signInAsFreshStudent,
  signInAsTeacher,
  sseBody,
} from './fixtures';
import { TEST_DATABASE_URL } from './global-setup';

test.setTimeout(90_000);

const DONE = (messageId: string): TurnEvent => ({ type: 'done', messageId, usage: [] });

/** content/demo-teacher's paid package name (`packages/paid.yaml`'s `name`), never hardcoded as
 * an arbitrary string so the locked notice reads like the real package it is blocking. */
const PAID_PACKAGE_NAME = 'Full course';

/** Unique per run, so a failed run's still-open question can never make the teacher inbox's
 * `getByText` match twice on a re-run against the same database (9.7a's clean-DB note). */
const UNCOVERED_QUESTION_TEXT = `Why does Python indentation matter so much? (e2e ${Date.now().toString(36)})`;
const TEACHER_ANSWER_TEXT = 'Indentation is how Python knows which lines belong to which block.';

const UNLOCKED_REPLY_TEXT = 'Here is the advanced topic, step by step.';

const STEP_TIMEOUT = 30_000;

/** Runs `act` (a fill and/or click) until a request (POST unless `method` says otherwise) whose path matches `path` is sent, then stops: an
 * attempt before hydration sends nothing (or natively reloads the form, clearing any fill) and is
 * retried whole; once the POST is out, `act` is never run again (file header). A fill clears the
 * box first: a pre-hydration fill leaves the DOM value equal to the text, and React ignores an
 * input event that doesn't change the value, so a same-value refill would leave its state empty. */
async function postOnce(
  page: Page,
  path: RegExp,
  act: () => Promise<void>,
  method: 'POST' | 'PATCH' = 'POST',
): Promise<void> {
  let sent = false;
  const onRequest = (request: Request): void => {
    if (request.method() === method && path.test(new URL(request.url()).pathname)) sent = true;
  };
  page.on('request', onRequest);
  try {
    await expect(async () => {
      if (sent) return;
      await act();
      await expect.poll(() => sent, { timeout: 2_000 }).toBe(true);
    }).toPass({ timeout: STEP_TIMEOUT });
  } finally {
    page.off('request', onRequest);
  }
}

/** Runs `act` (a GET search or a link click) until the page is at `url`. Only for idempotent
 * navigations: a dev-server reload between a fill and its submit (next dev recompiling, file
 * header) can send an empty search or drop a click, and repeating a GET or a link is harmless. */
async function navigateUntil(page: Page, url: RegExp, act: () => Promise<void>): Promise<void> {
  await expect(async () => {
    if (!url.test(page.url())) await act();
    await expect(page).toHaveURL(url, { timeout: 5_000 });
  }).toPass({ timeout: STEP_TIMEOUT });
}

/** A send's first POST: `/api/sessions` (opening the session, first message only) or the turn. */
const SEND_PATH = /^\/api\/sessions(\/[^/]+\/turns)?$/;

/** Sends one chat message exactly once (one POST to the turns route, one fixture consumed). */
async function sendMessage(page: Page, text: string): Promise<void> {
  await postOnce(page, SEND_PATH, async () => {
    const box = page.getByLabel('Your message');
    await box.fill('');
    await box.fill(text);
    await page.getByRole('button', { name: 'Send' }).click();
  });
}

test('full flow: discover -> subscribe (free) -> learn -> locked -> upgrade -> unlocked -> uncovered question -> teacher answer', async ({
  browser,
  baseURL,
}) => {
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  const teacherContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();

  try {
    let studentId = '';
    await test.step('sign in as a fresh, unsubscribed student', async () => {
      studentId = await signInAsFreshStudent(studentContext, baseURL!);
    });

    // The uncovered question is opened for real before any mocked turn references its id
    // (plan's open question 3): no Redis or worker runs in CI, so nothing opens it from the
    // mocked stream.
    const { repos, close } = openDatabase({ DATABASE_URL: TEST_DATABASE_URL });
    const question = await repos.teacherQuestions.open(
      { studentId, teacherId: DEMO_TEACHER },
      { agentId: DEMO_AGENT, text: UNCOVERED_QUESTION_TEXT, similarIds: [] },
    );
    await close();

    await mockTurns(studentPage, [
      sseBody([{ type: 'token', text: 'Hello! Ready to learn.' }, DONE('msg-full-flow-normal')]),
      sseBody([
        { type: 'token', text: 'That one is in a later package.' },
        { type: 'locked', packageName: PAID_PACKAGE_NAME },
        DONE('msg-full-flow-locked'),
      ]),
      sseBody([{ type: 'token', text: UNLOCKED_REPLY_TEXT }, DONE('msg-full-flow-unlocked')]),
      sseBody([
        { type: 'token', text: "I'll ask your teacher." },
        { type: 'teacher_question', questionId: question.id },
        DONE('msg-full-flow-teacher-q'),
      ]),
    ]);

    await test.step('discover: search, open the teacher page, choose a package', async () => {
      // Server-rendered GET form and plain links (9.2b/9.2c): each is idempotent, so a step lost
      // to a dev-server reload is simply repeated (navigateUntil), never a POST.
      await studentPage.goto('/teachers');
      // The query is typed and the form submitted in one in-page task: on a busy `next dev`, a
      // dev reload landing between a separate fill and click submitted the form empty (`?q=`).
      // It is still the page's own search box and Search button, found by label and role.
      const searchBox = studentPage.getByLabel('Search by subject or topic');
      const searchButton = studentPage.getByRole('button', { name: 'Search' });
      await navigateUntil(studentPage, /\/teachers\?q=Python$/, async () => {
        const button = await searchButton.elementHandle();
        await searchBox.evaluate(
          (input, submit) => {
            if (!(input instanceof HTMLInputElement) || !(submit instanceof HTMLButtonElement)) return;
            input.value = 'Python';
            input.form?.requestSubmit(submit);
          },
          button,
        );
      });
      await navigateUntil(studentPage, /\/teachers\/demo-teacher$/, () =>
        studentPage.getByRole('link', { name: 'Demo Teacher' }).click(),
      );
      await expect(studentPage.getByRole('heading', { level: 1, name: 'Demo Teacher' })).toBeVisible({
        timeout: STEP_TIMEOUT,
      });
      await navigateUntil(studentPage, /\/packages\/demo-agent$/, () =>
        studentPage.getByRole('link', { name: 'Choose a package' }).click(),
      );
    });

    await test.step('subscribe to the free package', async () => {
      const freeCard = studentPage.getByRole('listitem').filter({ hasText: 'Free starter' });
      await expect(freeCard.getByRole('button', { name: 'Start' })).toBeVisible();
      const start = freeCard.getByRole('button', { name: 'Start' });
      await postOnce(studentPage, /^\/api\/subscriptions$/, () => start.click());
      await expect(studentPage).toHaveURL(/\/learn\/demo-agent(\?.*)?$/, { timeout: STEP_TIMEOUT });
      await expect(studentPage.getByLabel('Your message')).toBeVisible({ timeout: STEP_TIMEOUT });
    });

    await test.step('learn: a normal reply streams in', async () => {
      const thread = studentPage.locator('ol[aria-live="polite"]');
      await sendMessage(studentPage, 'Hi tutor');
      await expect(thread).toContainText('Hello! Ready to learn.', { timeout: STEP_TIMEOUT });
    });

    await test.step('a locked topic shows the locked notice', async () => {
      const notice = studentPage.getByText(`This is part of ${PAID_PACKAGE_NAME}.`);
      await sendMessage(studentPage, 'Can you teach me the advanced topic?');
      await expect(notice).toBeVisible({ timeout: STEP_TIMEOUT });
    });

    await test.step('upgrade to the paid package (no payment until M10)', async () => {
      await studentPage.goto('/learn/demo-agent/plan');
      const paidOffer = studentPage.getByRole('listitem').filter({ hasText: PAID_PACKAGE_NAME });
      const upgrade = paidOffer.getByRole('button', { name: 'Upgrade' });
      await expect(upgrade).toBeVisible({ timeout: STEP_TIMEOUT });
      await postOnce(studentPage, /^\/api\/subscriptions\/[^/]+$/, () => upgrade.click(), 'PATCH');
      // A fresh session on the new package: `/learn/demo-agent` with no `?s=` (9.6 PlanView).
      await expect(studentPage).toHaveURL(/\/learn\/demo-agent$/, { timeout: STEP_TIMEOUT });
      await expect(studentPage.getByLabel('Your message')).toBeVisible({ timeout: STEP_TIMEOUT });
    });

    await test.step('the plan page now shows the paid package as current', async () => {
      const planPage = await studentContext.newPage();
      try {
        await planPage.goto('/learn/demo-agent/plan');
        const current = planPage.locator('section').filter({
          has: planPage.getByRole('heading', { name: 'Your current package' }),
        });
        await expect(current).toContainText(PAID_PACKAGE_NAME, { timeout: STEP_TIMEOUT });
      } finally {
        await planPage.close();
      }
    });

    await test.step('unlocked: the same kind of request now gets a reply, no locked notice', async () => {
      const thread = studentPage.locator('ol[aria-live="polite"]');
      await sendMessage(studentPage, 'Now can you teach me the advanced topic?');
      await expect(thread).toContainText(UNLOCKED_REPLY_TEXT, { timeout: STEP_TIMEOUT });
      await expect(studentPage.getByText(`This is part of ${PAID_PACKAGE_NAME}.`)).toHaveCount(0);
    });

    await test.step('an uncovered question is sent to the teacher', async () => {
      const notice = studentPage.getByText("Sent to your teacher. They'll answer in a live class or here.");
      await sendMessage(studentPage, UNCOVERED_QUESTION_TEXT);
      await expect(notice).toBeVisible({ timeout: STEP_TIMEOUT });
    });

    await test.step('the teacher sees and answers the question', async () => {
      await signInAsTeacher(teacherContext, baseURL!);
      await teacherPage.goto('/teacher/questions');
      await expect(teacherPage.getByText(UNCOVERED_QUESTION_TEXT)).toBeVisible();
      const answered = teacherPage.getByText('Answer sent to every student who asked.');
      await postOnce(teacherPage, /^\/api\/studio\/questions\/answer$/, async () => {
        const box = teacherPage.getByLabel('Your answer');
        await box.fill('');
        await box.fill(TEACHER_ANSWER_TEXT);
        await teacherPage.getByRole('button', { name: 'Send answer' }).click();
      });
      await expect(answered).toBeVisible({ timeout: STEP_TIMEOUT });
    });

    await test.step("the student reloads and sees the teacher's answer", async () => {
      const thread = studentPage.locator('ol[aria-live="polite"]');
      await expect(async () => {
        await studentPage.reload();
        await expect(thread).toContainText(TEACHER_ANSWER_TEXT, { timeout: 3_000 });
      }).toPass({ timeout: 20_000 });
    });
  } finally {
    await studentContext.close();
    await teacherContext.close();
  }
});
