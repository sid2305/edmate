// Task 9.4 Phase D: e2e helpers only. Signs in through a real, database-backed session cookie
// (the `build-smoke.test.ts` pattern: `identity.createSession`, no OAuth, no test hook in
// production code) and builds SSE fixture bytes, each event checked against `TurnEventSchema`
// when the fixture is built, so a typo here fails loudly instead of silently never matching.
import { randomBytes } from 'node:crypto';
import type { TurnEvent } from '@edmate/contracts';
import { openDatabase, type IdentityUser } from '@edmate/db';
import { formatSseEvent } from '@edmate/harness';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { TEST_DATABASE_URL } from './global-setup';

/** A free, active demo student (seed.ts): 'clear' status, a live package with `demo-agent`. */
export const DEMO_STUDENT = 'demo-student-01';
export const DEMO_AGENT = 'demo-agent';

/** http, not https: the dev server's AUTH_URL is http, so this is the un-prefixed cookie name
 * (`sessionCookieName(false)`, src/auth/config.ts). */
const SESSION_COOKIE = 'authjs.session-token';

async function withDb<T>(fn: (db: ReturnType<typeof openDatabase>) => Promise<T>): Promise<T> {
  const db = openDatabase({ DATABASE_URL: TEST_DATABASE_URL });
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

/** Issues a session token for `userId` and sets it as a cookie on `context`. */
async function signInSession(context: BrowserContext, baseURL: string, userId: string): Promise<void> {
  const token = randomBytes(24).toString('hex');
  await withDb(({ identity }) =>
    identity.createSession(token, userId, new Date(Date.now() + 86_400_000)),
  );
  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

/** Signs the browser context in as the seeded, 'clear', entitled demo student. */
export async function signInAsStudent(context: BrowserContext, baseURL: string): Promise<void> {
  await signInSession(context, baseURL, DEMO_STUDENT);
}

/**
 * A brand-new student, 15 years old, with no parental consent on record: `learnerStatus` is
 * `parent_needed` (the age gate, task 1.7; `DEFAULT_AGE_POLICY` requires consent under 18).
 */
export async function signInAsParentNeeded(context: BrowserContext, baseURL: string): Promise<void> {
  const user: IdentityUser = await withDb(async ({ identity }) => {
    const created = await identity.createStudent({
      email: `e2e-parent-needed-${randomBytes(4).toString('hex')}@example.invalid`,
      emailVerifiedAt: null,
      name: 'E2E Parent Needed',
    });
    await identity.recordAgeAnswer({
      userId: created.id,
      market: 'global',
      birthYear: new Date().getUTCFullYear() - 16,
      noticeVersion: 'e2e-test',
    });
    return created;
  });
  await signInSession(context, baseURL, user.id);
}

/** One SSE fixture's bytes, built from events checked against `TurnEventSchema` (via `formatSseEvent`). */
export function sseBody(events: readonly TurnEvent[]): string {
  return events.map((e) => formatSseEvent(e)).join('');
}

/**
 * Routes every `POST /api/sessions/:id/turns` request to the next fixture in `bodies`, in order;
 * a request past the end of the list reuses the last one. The real route is never reached: no
 * model call, no Redis dependency for the turn stream itself (plan: "no real model calls").
 */
export async function mockTurns(page: Page, bodies: readonly string[]): Promise<void> {
  if (bodies.length === 0) throw new Error('mockTurns: at least one fixture body is required');
  let at = 0;
  await page.route('**/api/sessions/*/turns', async (route: Route) => {
    const body = bodies[Math.min(at, bodies.length - 1)] ?? bodies[0]!;
    at += 1;
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
      },
      body,
    });
  });
}
