// @vitest-environment jsdom
// Task 8.7 Phase D: the publish page. Fetch is stubbed with a scripted publish API (rule 4: no
// database, no queue, no model). Covers idle, running (polls), passed, failed (cases grouped by
// gate group, the B-40-style empty-group reason shown as is), error (a plain message per code),
// and the lessons rules: every body read is guarded and the busy flag always clears.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import { PublishView } from './PublishView';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type Reply = { status: number; body?: unknown; raw?: string } | 'throw';
const json = (r: Exclude<Reply, 'throw'>) =>
  new Response(r.raw ?? (r.body === undefined ? null : JSON.stringify(r.body)), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
const err = (status: number, code: string, reason?: string): Reply => ({
  status,
  body: { error: { code, message: 'raw server text', retryable: false }, ...(reason ? { reason } : {}) },
});

/** GET replies are consumed in order (the last one repeats); POST replies are queued. */
function api(gets: Reply[], posts: Reply[] = []) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(method);
    const r = method === 'POST' ? (posts.shift() ?? err(500, 'provider_error')) : gets.length > 1 ? gets.shift()! : gets[0]!;
    if (r === 'throw') throw new TypeError('network');
    return json(r);
  });
  vi.stubGlobal('fetch', fetchFn);
  return { calls, fetchFn };
}

function run(over: Record<string, unknown> = {}) {
  return {
    runId: 'run_1',
    status: 'queued',
    changes: ['first_publish'],
    groups: [],
    errorCode: null,
    failedCases: [],
    scorecard: null,
    startedAt: '2026-10-22T10:00:00.000Z',
    finishedAt: null,
    publishedAt: null,
    changedSincePublish: false,
    ...over,
  };
}
const latest = (r: unknown): Reply => ({ status: 200, body: { run: r } });

const PASSED = run({
  status: 'passed',
  finishedAt: '2026-10-22T10:05:30.000Z',
  publishedAt: '2026-10-22T10:05:31.000Z',
  scorecard: {
    pass: true,
    changes: ['first_publish'],
    categories: [
      { key: 'accuracy', measured: true, total: 10, passed: 9, percent: 90, pass: true, byOrigin: [] },
      { key: 'locked_content', measured: false, total: 0, passed: 0, percent: null, pass: true, byOrigin: [] },
    ],
  },
});

const button = (name: RegExp) => screen.getByRole('button', { name });

describe('PublishView', () => {
  it('idle: nothing published yet, a Publish button, no axe violations', async () => {
    api([latest(null)]);
    const { container } = renderIntl(<PublishView pollMs={10} />);
    expect(await screen.findByText('Your agent has not been published yet.')).toBeInTheDocument();
    expect(button(/^Publish$/)).toBeEnabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('publish: POST {} then polls while running, then shows the passed run with its scorecard', async () => {
    const { calls, fetchFn } = api(
      [latest(null), latest(run({ status: 'queued' })), latest(run({ status: 'running' })), latest(PASSED)],
      [{ status: 202, body: { runId: 'run_1' } }],
    );
    const { container } = renderIntl(<PublishView pollMs={10} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Publish$/ }));
    expect(await screen.findByText(/The quality gate is checking your agent/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Publish/ })).toBeDisabled();
    expect(screen.getByText('First publish')).toBeInTheDocument();
    expect(await screen.findByText('Your agent is live.')).toBeInTheDocument();
    expect(screen.getByText('Published 2026-10-22 10:05 UTC.')).toBeInTheDocument();
    expect(screen.getByText('Checks finished 2026-10-22 10:05 UTC.')).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Teaching scorecard' });
    expect(within(card).getByText('Accuracy: 9 of 10 passed (90%)')).toBeInTheDocument();
    expect(within(card).getByText('Locked content stays locked: not measured in this check')).toBeInTheDocument();
    expect(button(/Publish again/)).toBeEnabled();
    expect(calls[1]).toBe('POST');
    expect(fetchFn.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{}' });
    const polls = calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.length).toBe(polls); // polling stops once the run is finished
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a passed run with changedSincePublish shows the note; a clean one does not (task 8.7k)', async () => {
    api([latest({ ...PASSED, changedSincePublish: true })]);
    const { container } = renderIntl(<PublishView pollMs={10} />);
    expect(await screen.findByText('Your agent is live.')).toBeInTheDocument();
    expect(
      screen.getByText("You've made changes since your last publish."),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a passed run with no changes since publish shows no note', async () => {
    api([latest(PASSED)]);
    const { container } = renderIntl(<PublishView pollMs={10} />);
    expect(await screen.findByText('Your agent is live.')).toBeInTheDocument();
    expect(
      screen.queryByText("You've made changes since your last publish."),
    ).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('failed: lists failed cases grouped by gate group, with the why and the teacher question', async () => {
    api([
      latest(
        run({
          status: 'failed',
          finishedAt: '2026-10-22T10:05:00.000Z',
          groups: [
            { origin: 'platform', group: 'accuracy', total: 0, passed: 0, minPercent: 90, pass: false, reason: 'empty_group' },
            { origin: 'agent', group: 'accuracy', total: 10, passed: 7, minPercent: 90, pass: false, reason: 'below_threshold' },
            { origin: 'platform', group: 'safety', total: 5, passed: 5, minPercent: 100, pass: true },
          ],
          failedCases: [
            { caseId: 'acc-1', origin: 'agent', group: 'accuracy', suite: 'accuracy', failedChecks: ['expected_answer'], question: 'What is 2+2?' },
            { caseId: 'leak-9', origin: 'platform', group: 'leak', suite: 'leak', failedChecks: ['no_prompt_leak', 'refusal'] },
            { caseId: 'x-1', origin: 'platform', group: 'brand_new', suite: 'x', failedChecks: [] },
          ],
        }),
      ),
    ]);
    const { container } = renderIntl(<PublishView pollMs={10} />);
    expect(await screen.findByText(/some checks did not pass/)).toBeInTheDocument();
    const groups = screen.getByRole('region', { name: 'Groups that did not pass' });
    expect(within(groups).getByText('Accuracy (platform tests): there are no test cases for this group yet, so it cannot pass.')).toBeInTheDocument();
    expect(within(groups).getByText('Accuracy (your tests): 7 of 10 passed; needs 90%.')).toBeInTheDocument();
    expect(within(groups).queryByText(/Safety/)).toBeNull();
    const cases = screen.getByRole('region', { name: 'Cases that failed' });
    const acc = within(cases).getByRole('heading', { name: 'Accuracy' }).closest('section')!;
    expect(within(acc).getByText('Case acc-1')).toBeInTheDocument();
    expect(within(acc).getByText('Why: expected_answer')).toBeInTheDocument();
    expect(within(acc).getByText('Your question: What is 2+2?')).toBeInTheDocument();
    const leak = within(cases).getByRole('heading', { name: 'Hidden content stays hidden' }).closest('section')!;
    expect(within(leak).getByText('Why: no_prompt_leak, refusal')).toBeInTheDocument();
    expect(within(leak).queryByText(/Your question/)).toBeNull();
    expect(within(cases).getByRole('heading', { name: 'Other checks' })).toBeInTheDocument();
    expect(button(/Publish again/)).toBeEnabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each([
    ['gate_unavailable', /needs a model key/],
    ['stale', /stopped before it finished/],
    ['enqueue_failed', /could not be started/],
    ['not_verified', /not verified, so nothing was published/],
    ['suspended', /suspended, so nothing was published/],
    ['regulated_unapproved', /Edmate staff review it before it can be published/],
    ['repository_failed', /Something went wrong during the check/],
    [null, /Something went wrong during the check/],
  ])('error run %s: a plain message, never the raw code', async (code, text) => {
    api([latest(run({ status: 'error', errorCode: code, finishedAt: '2026-10-22T10:01:00.000Z' }))]);
    renderIntl(<PublishView pollMs={10} />);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText('The check did not finish.')).toBeInTheDocument();
    if (code?.includes('_')) expect(document.body.textContent).not.toContain(code);
    expect(button(/Publish again/)).toBeEnabled();
  });

  it.each([
    [err(409, 'validation', 'nothing_to_publish'), 'Nothing has changed since your last publish.'],
    [err(409, 'validation', 'gate_running'), 'A check is already running. Wait for it to finish.'],
    [err(403, 'forbidden', 'not_verified'), 'Your profile must be verified before you can publish.'],
    [err(409, 'validation', 'no_packages'), 'Make at least one package before you publish.'],
    [err(409, 'validation', 'style_card_required'), 'Set up your style card before you publish.'],
    [err(409, 'validation', 'suspended'), 'Your agent is suspended, so it cannot be published.'],
    [
      err(409, 'validation', 'regulated_unapproved'),
      "Your agent covers a regulated subject (investing, health or law), so Edmate staff review it before it can be published. We'll let you know when it's approved.",
    ],
    [err(409, 'validation', 'conflict'), 'Something changed while you were publishing. Reload and try again.'],
    [err(503, 'provider_error', 'unavailable'), 'Publishing is not available right now. Try again soon.'],
    [err(500, 'provider_error', 'something_new'), 'Something went wrong. Try again.'],
    [{ status: 500, raw: 'not json' } as Reply, 'Something went wrong. Try again.'],
    [{ status: 202, raw: 'not json' } as Reply, 'Something went wrong. Try again.'],
    [{ status: 202, body: { wrong: true } } as Reply, 'Something went wrong. Try again.'],
    ['throw' as Reply, 'Something went wrong. Try again.'],
  ])('a refused start shows a plain message and the button comes back (%#)', async (reply, text) => {
    api([latest(null)], [reply]);
    renderIntl(<PublishView pollMs={10} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Publish$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(document.body.textContent).not.toContain('raw server text');
    await waitFor(() => expect(button(/^Publish$/)).toBeEnabled());
  });

  it('a start error is cleared by the next start', async () => {
    api([latest(null), latest(run({ status: 'running' }))], [err(409, 'validation', 'gate_running'), { status: 202, body: { runId: 'run_1' } }]);
    renderIntl(<PublishView pollMs={1000} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Publish$/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(button(/^Publish$/)).toBeEnabled());
    fireEvent.click(button(/^Publish$/));
    expect(await screen.findByText(/The quality gate is checking your agent/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['an error status', err(500, 'provider_error')],
    ['a malformed body', { status: 200, body: { run: { status: 'weird' } } } as Reply],
    ['unreadable JSON', { status: 200, raw: '{' } as Reply],
    ['a network failure', 'throw' as Reply],
  ])('a load with %s shows the load error, no Publish button', async (_n, reply) => {
    api([reply]);
    renderIntl(<PublishView pollMs={10} />);
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a poll that fails keeps the last run and keeps polling until it finishes', async () => {
    const { calls } = api([latest(run({ status: 'running' })), err(503, 'provider_error'), latest(PASSED)]);
    renderIntl(<PublishView pollMs={10} />);
    expect(await screen.findByText(/The quality gate is checking your agent/)).toBeInTheDocument();
    expect(await screen.findByText('Your agent is live.')).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
    // At least the three scripted replies; no more polls once the run is finished (no exact
    // count: a slow CI runner can fire one extra tick before the effect cleans up).
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const n = calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.length).toBe(n);
  });

  it('stops polling when unmounted', async () => {
    const { calls } = api([latest(run({ status: 'running' }))]);
    const view = renderIntl(<PublishView pollMs={10} />);
    expect(await screen.findByText(/The quality gate is checking your agent/)).toBeInTheDocument();
    view.unmount();
    const n = calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.length).toBe(n);
  });
});
