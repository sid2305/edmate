// Task 9.7 Phase A: one student and one teacher, end to end, against a real `next dev` and a
// real Postgres (same stack as chat.spec.ts). No step calls a real model or a real payment
// provider: every model-shaped answer is a `page.route`-intercepted SSE fixture (fixtures.ts's
// `sseBody`/`mockTurns`), and subscribing a paid package needs no payment (CLAUDE.md: a paid
// package starts as an active subscription until M10). Every other step -- sign-in, subscribing,
// the teacher's questions inbox and answer -- is the real route over the real seeded Postgres.
//
// Starts at `/packages/demo-agent` (no discovery UI yet, plan 9.7 Phase A) and ends there (no
// upgrade yet -- that is Phase B, which waits on 9.2c and 9.6). The "uncovered question" is seeded
// directly through the real `teacherQuestions.open` repository (plan's open question 3): the
// student's chat turns stay fully mocked, but the question/answer state is always real.
//
// Next dev compiles each route on its first visit; on a loaded CI/dev box that first compile can
// outlast a plain click/fill, which would otherwise race hydration (the server-rendered control
// is visible, and actionable, before React attaches its listeners). Every interaction that
// depends on a just-navigated page's own JS is therefore wrapped in `expect(...).toPass(...)`,
// retrying the whole fill/click + assert pair rather than trusting the first attempt.
import type { TurnEvent } from '@edmate/contracts';
import { openDatabase } from '@edmate/db';
import { expect, test, type Locator, type Page } from '@playwright/test';
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

const UNCOVERED_QUESTION_TEXT = 'Why does Python indentation matter so much?';
const TEACHER_ANSWER_TEXT = 'Indentation is how Python knows which lines belong to which block.';

/** Sends one chat message, retrying the fill/click pair until `expectation` passes (see the
 * file header: a just-navigated page's hydration can still be in flight). */
async function sendMessageUntil(page: Page, text: string, expectation: () => Promise<void>): Promise<void> {
  const box = page.getByLabel('Your message');
  const send = page.getByRole('button', { name: 'Send' });
  await expect(async () => {
    await box.fill(text);
    await send.click();
    await expectation();
  }).toPass({ timeout: 30_000 });
}

/** Clicks `locator`, retrying until `expectation` passes (see the file header). */
async function clickUntil(locator: Locator, expectation: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await locator.click();
    await expectation();
  }).toPass({ timeout: 30_000 });
}

test('discover-less full flow: subscribe (free) -> learn -> locked -> uncovered question -> teacher answer', async ({
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
      sseBody([
        { type: 'token', text: "I'll ask your teacher." },
        { type: 'teacher_question', questionId: question.id },
        DONE('msg-full-flow-teacher-q'),
      ]),
    ]);

    await test.step('subscribe to the free package', async () => {
      await studentPage.goto('/packages/demo-agent');
      const freeCard = studentPage.getByRole('listitem').filter({ hasText: 'Free starter' });
      await expect(freeCard.getByRole('button', { name: 'Start' })).toBeVisible();
      await clickUntil(freeCard.getByRole('button', { name: 'Start' }), () =>
        expect(studentPage).toHaveURL(/\/learn\/demo-agent(\?.*)?$/, { timeout: 3_000 }),
      );
      await expect(studentPage.getByLabel('Your message')).toBeVisible();
    });

    await test.step('learn: a normal reply streams in', async () => {
      const thread = studentPage.locator('ol[aria-live="polite"]');
      await sendMessageUntil(studentPage, 'Hi tutor', () =>
        expect(thread).toContainText('Hello! Ready to learn.', { timeout: 3_000 }),
      );
    });

    await test.step('a locked topic shows the locked notice', async () => {
      const notice = studentPage.getByText(`This is part of ${PAID_PACKAGE_NAME}.`);
      await sendMessageUntil(studentPage, 'Can you teach me the advanced topic?', () =>
        expect(notice).toBeVisible({ timeout: 3_000 }),
      );
    });

    await test.step('an uncovered question is sent to the teacher', async () => {
      const notice = studentPage.getByText("Sent to your teacher. They'll answer in a live class or here.");
      await sendMessageUntil(studentPage, UNCOVERED_QUESTION_TEXT, () =>
        expect(notice).toBeVisible({ timeout: 3_000 }),
      );
    });

    await test.step('the teacher sees and answers the question', async () => {
      await signInAsTeacher(teacherContext, baseURL!);
      await teacherPage.goto('/teacher/questions');
      await expect(teacherPage.getByText(UNCOVERED_QUESTION_TEXT)).toBeVisible();
      const answered = teacherPage.getByText('Answer sent to every student who asked.');
      await expect(async () => {
        await teacherPage.getByLabel('Your answer').fill(TEACHER_ANSWER_TEXT);
        await teacherPage.getByRole('button', { name: 'Send answer' }).click();
        await expect(answered).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
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
