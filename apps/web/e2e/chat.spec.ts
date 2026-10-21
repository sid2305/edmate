// Task 9.4 Phase D: the student chat, end to end, against a real `next dev` and a real Postgres.
// Signs in through a database session cookie (fixtures.ts); the turn stream itself is always
// intercepted with `page.route` -- SSE fixture bytes, each event checked against `TurnEventSchema`
// when built (fixtures.ts's `sseBody`) -- so no real model call is ever made. `POST /api/sessions`
// is the real route (the plan: "a page.route fixture for the turns route is enough once a session
// exists").
import type { TurnEvent } from '@edmate/contracts';
import { expect, test } from '@playwright/test';
import { DEMO_AGENT, mockTurns, signInAsParentNeeded, signInAsStudent, sseBody } from './fixtures';

const DONE = (messageId: string): TurnEvent => ({ type: 'done', messageId, usage: [] });

test.describe('student chat', () => {
  test('normal: a message gets a streamed, then final, reply', async ({ page, context, baseURL }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [
      sseBody([{ type: 'token', text: 'Hello ' }, { type: 'token', text: 'there!' }, DONE('msg-normal')]),
    ]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByLabel('Your message').fill('Hi tutor');
    await page.getByLabel('Your message').press('Enter');

    const thread = page.locator('ol[aria-live="polite"]');
    await expect(thread).toContainText('Hello there!');
    await expect(page.locator('.chat-provisional')).toHaveCount(0);
  });

  test('retry-after-replace: replace \'\' clears the draft before the retry streams in', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [
      sseBody([
        { type: 'token', text: 'Draft reply' },
        { type: 'replace', text: '' },
        { type: 'token', text: 'Retried reply' },
        DONE('msg-retry'),
      ]),
    ]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByLabel('Your message').fill('Question');
    await page.getByLabel('Your message').press('Enter');

    const thread = page.locator('ol[aria-live="polite"]');
    await expect(thread).toContainText('Retried reply');
    await expect(thread).not.toContainText('Draft reply');
  });

  test('replace-with-text: a correction is visibly marked "Updated"', async ({ page, context, baseURL }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [
      sseBody([
        { type: 'token', text: 'Wrong reply' },
        { type: 'replace', text: 'Corrected reply' },
        DONE('msg-replace'),
      ]),
    ]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByLabel('Your message').fill('Question');
    await page.getByLabel('Your message').press('Enter');

    const thread = page.locator('ol[aria-live="polite"]');
    await expect(thread).toContainText('Corrected reply');
    await expect(thread).not.toContainText('Wrong reply');
    await expect(thread.getByText('Updated')).toBeVisible();
  });

  test('error-mid-stream: a retryable error drops the draft and offers "Try again"', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [
      sseBody([
        { type: 'token', text: 'Partial' },
        { type: 'error', code: 'provider_error', retryable: true },
      ]),
      sseBody([{ type: 'token', text: 'Fixed reply' }, DONE('msg-fixed')]),
    ]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByLabel('Your message').fill('Question');
    await page.getByLabel('Your message').press('Enter');

    // Next.js's own `#__next-route-announcer__` is also `role="alert"` (always present, empty),
    // so the chat's error banner is found by its class, not role alone.
    const alert = page.locator('.chat-error');
    await expect(alert).toContainText('Something went wrong');
    await expect(page.locator('ol[aria-live="polite"]')).not.toContainText('Partial');

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('ol[aria-live="polite"]')).toContainText('Fixed reply');
    await expect(page.locator('.chat-error')).toHaveCount(0);
  });

  test('cut-stream: a stream that ends without done or error drops the reply', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [sseBody([{ type: 'token', text: 'Oops' }])]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByLabel('Your message').fill('Question');
    await page.getByLabel('Your message').press('Enter');

    await expect(page.locator('.chat-error')).toContainText('Something went wrong');
    await expect(page.locator('ol[aria-live="polite"]')).not.toContainText('Oops');
  });

  test('locked: a locked topic shows the locked notice', async ({ page, context, baseURL }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [
      sseBody([
        { type: 'token', text: 'Some reply' },
        { type: 'locked', packageName: 'Advanced Package' },
        DONE('msg-locked'),
      ]),
    ]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByLabel('Your message').fill('Question');
    await page.getByLabel('Your message').press('Enter');

    await expect(page.getByText('This is part of Advanced Package.')).toBeVisible();
  });

  test('teacher-question: the tutor sends the question to the teacher', async ({ page, context, baseURL }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [
      sseBody([
        { type: 'token', text: "I'll ask your teacher." },
        { type: 'teacher_question', questionId: 'q-1' },
        DONE('msg-teacher-q'),
      ]),
    ]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByLabel('Your message').fill('A hard question');
    await page.getByLabel('Your message').press('Enter');

    await expect(page.getByText("Sent to your teacher. They'll answer in a live class or here.")).toBeVisible();
  });

  test('hint-rung: the hint button shows the rung of help given', async ({ page, context, baseURL }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [
      sseBody([
        { type: 'hint_rung', rung: 3 },
        { type: 'token', text: 'Here is a worked example.' },
        DONE('msg-hint'),
      ]),
    ]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByRole('button', { name: 'Get a hint' }).click();

    await expect(page.getByText('Last help: Worked example')).toBeVisible();
  });

  test('html-in-tokens: raw HTML in the stream never renders, text shows literally', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [
      sseBody([
        { type: 'token', text: '<scri' },
        { type: 'token', text: 'pt>alert(1)</scr' },
        { type: 'token', text: 'ipt><img src=x onerror=alert(2)> <a href="javascript:alert(3)">click</a>' },
        { type: 'token', text: ' <iframe></iframe> <!-- c --> end' },
        DONE('msg-html'),
      ]),
    ]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByLabel('Your message').fill('Show me some markup');
    await page.getByLabel('Your message').press('Enter');

    const thread = page.locator('ol[aria-live="polite"]');
    await expect(thread).toContainText('<script>alert(1)</script>');
    await expect(thread).toContainText('end');
    await expect(thread.locator('script, img, iframe')).toHaveCount(0);
  });

  test('parent-needed: a student awaiting consent is redirected to the age gate', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsParentNeeded(context, baseURL!);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await expect(page).toHaveURL(/\/welcome\/age$/);
  });
});
