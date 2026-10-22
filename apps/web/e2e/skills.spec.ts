// Task 9.5a: the practice skill end to end, against a real `next dev` and a real Postgres. Signs
// in through a database session cookie (fixtures.ts); the turn stream is always intercepted with
// `page.route` -- SSE fixture bytes, each event checked against `TurnEventSchema` when built
// (fixtures.ts's `sseBody`) -- so no real model call is ever made. Feedback and mock-interview
// cases are 9.5b.
import type { TurnEvent } from '@edmate/contracts';
import { expect, test } from '@playwright/test';
import { DEMO_AGENT, mockTurns, signInAsStudent, sseBody } from './fixtures';

const DONE = (messageId: string): TurnEvent => ({ type: 'done', messageId, usage: [] });
const practiceItem = (id: string, prompt: string): TurnEvent => ({
  type: 'skill',
  skill: 'practice',
  payload: { id, kind: 'numeric', level: 1, prompt },
});

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
