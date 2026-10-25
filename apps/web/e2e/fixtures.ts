// Task 9.4 Phase D: e2e helpers only. Signs in through a real, database-backed session cookie
// (the `build-smoke.test.ts` pattern: `identity.createSession`, no OAuth, no test hook in
// production code) and builds SSE fixture bytes, each event checked against `TurnEventSchema`
// when the fixture is built, so a typo here fails loudly instead of silently never matching.
import { randomBytes } from 'node:crypto';
import type { TurnEvent } from '@edmate/contracts';
import { openDatabase, type IdentityUser } from '@edmate/db';
import { formatSseEvent } from '@edmate/harness';
import { expect, type BrowserContext, type Page, type Request, type Route } from '@playwright/test';
import { TEST_DATABASE_URL } from './global-setup';

/** Next.js compiles each route on its first visit; on a loaded CI/dev box that first compile can
 * outlast a plain click/fill, which would otherwise race hydration (the server-rendered control
 * is visible, and actionable, before React attaches its listeners, so an early click is a no-op).
 * `postOnce` retries only until the action's own request has left the browser, never after: a
 * mocked turns route hands out single-use fixtures in a fixed order, so a second POST would
 * desync the flow (full-flow.spec.ts's file header). */
export const STEP_TIMEOUT = 30_000;

/** A send's first POST: `/api/sessions` (opening the session, first message only) or the turn. */
export const SEND_PATH = /^\/api\/sessions(\/[^/]+\/turns)?$/;

/** Runs `act` (a fill and/or click) until a request (POST unless `method` says otherwise) whose path matches `path` is sent, then stops: an
 * attempt before hydration sends nothing (or natively reloads the form, clearing any fill) and is
 * retried whole; once the request is out, `act` is never run again (see the doc comment above). */
export async function postOnce(
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

/** A free, active demo student (seed.ts): 'clear' status, a live package with `demo-agent`. */
export const DEMO_STUDENT = 'demo-student-01';
export const DEMO_AGENT = 'demo-agent';
/** The seeded demo teacher (seed.ts's `DEMO_IDS.teacher`), verified in global-setup.ts (task 9.7). */
export const DEMO_TEACHER = 'demo-teacher';

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

/** Signs the browser context in as the seeded demo teacher (task 9.7). */
export async function signInAsTeacher(
  context: BrowserContext,
  baseURL: string,
  userId = DEMO_TEACHER,
): Promise<void> {
  await signInSession(context, baseURL, userId);
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

/**
 * A brand-new, 'clear' adult student (task 9.7) with no subscription at all: every one of
 * `seed.ts`'s 20 fictional students already has a subscription row (`subscriptionKind`), so
 * `DEMO_STUDENT` cannot exercise the "subscribe to a free package" step -- `/packages/demo-agent`
 * shows "You already have a package with this teacher" for it. This student is old enough that
 * the age gate needs no parental consent (`learnerStatus: 'clear'`), so it can reach a package's
 * compare-and-start page for real. Returns the created user id (`teacherQuestions.open`'s scope
 * needs it).
 */
export async function signInAsFreshStudent(context: BrowserContext, baseURL: string): Promise<string> {
  const user: IdentityUser = await withDb(async ({ identity }) => {
    const created = await identity.createStudent({
      email: `e2e-fresh-student-${randomBytes(4).toString('hex')}@example.invalid`,
      emailVerifiedAt: null,
      name: 'E2E Fresh Student',
    });
    await identity.recordAgeAnswer({
      userId: created.id,
      market: 'global',
      birthYear: new Date().getUTCFullYear() - 25,
      noticeVersion: 'e2e-test',
    });
    return created;
  });
  await signInSession(context, baseURL, user.id);
  return user.id;
}

/** One SSE fixture's bytes, built from events checked against `TurnEventSchema` (via `formatSseEvent`). */
export function sseBody(events: readonly TurnEvent[]): string {
  return events.map((e) => formatSseEvent(e)).join('');
}

/**
 * Routes every `POST /api/sessions/:id/turns` request to the next fixture in `bodies`, in order,
 * each single-use. The real route is never reached: no model call, no Redis dependency for the
 * turn stream itself (plan: "no real model calls").
 *
 * A request past the end of `bodies` used to reuse the last fixture, which let a double-send
 * (`postOnce` re-running its `act` if a real post-hydration request outlasts the inner 2s poll,
 * fixtures.ts's doc comment above) pass silently (9.7d review MEDIUM, deferred to 9.7e). It now
 * fails loudly instead: the extra request gets a 500 (so the page's own stream-error UI shows
 * rather than hanging), and the handler then throws, which Playwright Test surfaces as a failed
 * test via its unhandled-rejection reporting. A test that really expects more turns than one send
 * per fixture must script that many fixtures up front -- `bodies` is never implicitly stretched.
 */
export async function mockTurns(page: Page, bodies: readonly string[]): Promise<void> {
  if (bodies.length === 0) throw new Error('mockTurns: at least one fixture body is required');
  let at = 0;
  await page.route('**/api/sessions/*/turns', async (route: Route) => {
    if (at >= bodies.length) {
      const message =
        `mockTurns: turn request #${at + 1} has no scripted fixture (only ${bodies.length} ` +
        'provided) -- likely a double-send (postOnce re-running act after a slow hydration) or ' +
        'a test sending more turns than it scripted; add one fixture per expected send.';
      await route.fulfill({ status: 500, headers: { 'content-type': 'text/plain' }, body: message });
      throw new Error(message);
    }
    const body = bodies[at]!;
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
