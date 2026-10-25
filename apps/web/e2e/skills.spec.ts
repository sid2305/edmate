// Task 9.5: all three skill screens end to end, against a real `next dev` and a real Postgres.
// Signs in through a database session cookie (fixtures.ts); the turn stream is always intercepted
// with `page.route` -- SSE fixture bytes, each event checked against `TurnEventSchema` when built
// (fixtures.ts's `sseBody`) -- so no real model call is ever made.
// 13.skillpresent Phase B: feedback and mock interview now also carry a harness-computed `skill`
// progress event (Phase A) alongside the plain `token`/`done` text; these fixtures include it so
// the structured progress line (mock interview) and the confirmation marker (feedback) render.
import type { TurnEvent } from '@edmate/contracts';
import { expect, test } from '@playwright/test';
import { DEMO_AGENT, mockTurns, signInAsStudent, sseBody } from './fixtures';

const DONE = (messageId: string): TurnEvent => ({ type: 'done', messageId, usage: [] });
const TOKEN = (text: string): TurnEvent => ({ type: 'token', text });
const LOCKED = (packageName: string): TurnEvent => ({ type: 'locked', packageName });
const practiceItem = (id: string, prompt: string): TurnEvent => ({
  type: 'skill',
  skill: 'practice',
  payload: { id, kind: 'numeric', level: 1, prompt },
});
const FEEDBACK_GIVEN: TurnEvent = { type: 'skill', skill: 'feedback', payload: { given: true } };
const rolePlayProgress = (payload: unknown): TurnEvent => ({ type: 'skill', skill: 'mock_interview', payload });

test.describe('practice skill', () => {
  test('a student starts practice, answers, and gets a fresh item on a correct attempt', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [
      sseBody([practiceItem('itm-1', 'What is 2 + 2?'), DONE('msg-practice-start')]),
      sseBody([practiceItem('itm-2', 'What is 3 + 5?'), DONE('msg-practice-next')]),
    ]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByRole('button', { name: 'Practice' }).click();

    await expect(page.getByText('What is 2 + 2?')).toBeVisible();
    await page.getByLabel('Your answer').fill('4');
    await page.getByRole('button', { name: 'Submit answer' }).click();

    // A fresh item card on the correct attempt; the earlier item stays in the thread's history.
    await expect(page.getByText('What is 3 + 5?')).toBeVisible();
    await expect(page.getByText('What is 2 + 2?')).toBeVisible();
  });
});

test.describe('feedback skill', () => {
  test('a submission tagged skill: feedback renders the verdict text in the thread', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [
      sseBody([FEEDBACK_GIVEN, TOKEN('Good structure, but your thesis needs work.'), DONE('msg-feedback')]),
    ]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByRole('button', { name: 'Get feedback' }).click();
    await page.getByRole('textbox', { name: 'Your message' }).fill('Here is my essay draft.');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText('Good structure, but your thesis needs work.')).toBeVisible();
    await expect(page.getByText('Feedback given')).toBeVisible();
  });
});

test.describe('mock interview skill', () => {
  test('a persona pick, an answer, /pause and stop each render the structured progress', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [
      sseBody([
        rolePlayProgress({ phase: 'question', question: 1, total: 3 }),
        TOKEN('Tell me about a time you solved a hard problem.'),
        DONE('msg-start'),
      ]),
      sseBody([
        rolePlayProgress({ phase: 'question', question: 2, total: 3 }),
        TOKEN('Good example. Next: why this role?'),
        DONE('msg-answer'),
      ]),
      sseBody([
        rolePlayProgress({ phase: 'pause', question: 2, total: 3 }),
        TOKEN('Paused. Send any message to resume.'),
        DONE('msg-pause'),
      ]),
      sseBody([
        rolePlayProgress({ phase: 'stopped', answered: 1 }),
        TOKEN('Debrief: strong answers, keep practicing structure.'),
        DONE('msg-stop'),
      ]),
    ]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByRole('button', { name: 'Job interview' }).click();
    await expect(page.getByText('Tell me about a time you solved a hard problem.')).toBeVisible();
    await expect(page.getByText('Question 1 of 3')).toBeVisible();

    await page.getByRole('textbox', { name: 'Your message' }).fill('I debugged a tricky race condition.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Good example. Next: why this role?')).toBeVisible();
    await expect(page.getByText('Question 2 of 3')).toBeVisible();

    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused. Send any message to resume.')).toBeVisible();
    await expect(page.getByText('Paused — question 2 of 3')).toBeVisible();

    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Debrief: strong answers, keep practicing structure.')).toBeVisible();
    await expect(page.getByText('Interview stopped — 1 question(s) answered')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  });

  test('an unentitled skill surfaces the existing locked notice', async ({ page, context, baseURL }) => {
    await signInAsStudent(context, baseURL!);
    await mockTurns(page, [sseBody([LOCKED('Interview Prep'), TOKEN('That is in another package.'), DONE('msg-locked')])]);
    await page.goto(`/learn/${DEMO_AGENT}`);
    await page.getByRole('button', { name: 'Viva' }).click();

    await expect(page.getByText('This is part of Interview Prep.')).toBeVisible();
  });
});
