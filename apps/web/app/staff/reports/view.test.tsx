// @vitest-environment jsdom
// Task 12.2e: the staff reports and takedowns console. Each action (dismiss, take down a cited
// document, take down the agent, lift) needs a confirm step; a confirmed action removes its row
// and shows a notice; every action resets its busy flag (success, error reply, or a thrown call);
// a server payload of the wrong shape shows the fallback view, never a crash; polling is paused
// while an action is in flight. A tiny `pollMs` (as in the alert inbox's own tests) lets the
// polling tests use the real clock, no fake timers.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import type { ReportView, TakedownView } from './client';
import { StaffReportsView } from './view';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

function report(o: Partial<ReportView> & { id: string }): ReportView {
  return {
    category: 'harmful',
    status: 'open',
    createdAt: '2026-10-22T00:00:00.000Z',
    messageId: 'msg_1',
    teacherId: 'tch_a',
    agentId: 'agt_1',
    teacherSlug: 'asha-math',
    message: { role: 'agent', text: 'synthetic reply text', createdAt: '2026-10-22T00:00:00.000Z' },
    citedDocuments: [],
    ...o,
  };
}

function takedown(o: Partial<TakedownView> & { id: string }): TakedownView {
  return {
    kind: 'document',
    targetId: 'doc_1',
    teacherId: 'tch_a',
    teacherSlug: 'asha-math',
    category: 'copyright',
    createdAt: '2026-10-22T00:00:00.000Z',
    ...o,
  };
}

const REPORT = report({ id: 'rp_1' });
const REPORT_WITH_DOC = report({
  id: 'rp_2',
  citedDocuments: [{ id: 'doc_1', title: 'Week 3 notes', kind: 'material', takenDown: false }],
});
const TAKEDOWN = takedown({ id: 'tkd_1' });

const never = () => new Promise<never>(() => undefined);

const okReports = async () => ({ ok: true as const, reports: [] });
const okTakedowns = async () => ({ ok: true as const, takedowns: [] });

describe('StaffReportsView', () => {
  it('lists each open report with category, teacher slug and reported text', () => {
    renderIntl(<StaffReportsView initialReports={[REPORT]} initialTakedowns={[]} />);
    const row = within(screen.getByRole('list', { name: 'Open reports' })).getByRole('listitem');
    expect(within(row).getByText('Harmful')).toBeInTheDocument();
    expect(within(row).getByText('asha-math')).toBeInTheDocument();
    expect(within(row).getByText('synthetic reply text')).toBeInTheDocument();
  });

  it('announces the open-report count in an aria-live region', () => {
    renderIntl(<StaffReportsView initialReports={[REPORT, REPORT_WITH_DOC]} initialTakedowns={[]} />);
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).toHaveTextContent('2 open reports');
  });

  it('shows the empty states when there is nothing open and no active takedowns', () => {
    renderIntl(<StaffReportsView initialReports={[]} initialTakedowns={[]} />);
    expect(screen.getByText('No open reports.')).toBeInTheDocument();
    expect(screen.getByText('No active takedowns.')).toBeInTheDocument();
  });

  it('dismiss needs a confirm step: the first click only asks', () => {
    renderIntl(<StaffReportsView initialReports={[REPORT]} initialTakedowns={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('alert')).toHaveTextContent("This can't be undone from here. Confirm?");
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });

  it('cancel after asking to dismiss leaves the report in the queue', () => {
    renderIntl(<StaffReportsView initialReports={[REPORT]} initialTakedowns={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('dismiss, confirmed: reviews the report and drops it from the queue', async () => {
    const reviewReport = vi.fn(async () => ({ ok: true as const, id: 'rp_1' }));
    renderIntl(
      <StaffReportsView
        initialReports={[REPORT]}
        initialTakedowns={[]}
        reviewReport={reviewReport}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull());
    expect(reviewReport).toHaveBeenCalledWith({ reportId: 'rp_1', decision: 'dismissed' });
    expect(screen.getByRole('status')).toHaveTextContent('Done.');
  });

  it('take down a cited document, confirmed: creates the takedown linked to the report', async () => {
    const createTakedown = vi.fn(async () => ({ ok: true as const, id: 'tkd_new' }));
    renderIntl(
      <StaffReportsView
        initialReports={[REPORT_WITH_DOC]}
        initialTakedowns={[]}
        createTakedown={createTakedown}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Take down this document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull());
    expect(createTakedown).toHaveBeenCalledWith({
      kind: 'document',
      targetId: 'doc_1',
      category: 'harmful',
      reportId: 'rp_2',
    });
  });

  it('a document already taken down shows a marker, not a button', () => {
    const taken = report({
      id: 'rp_3',
      citedDocuments: [{ id: 'doc_1', title: 'Week 3 notes', kind: 'material', takenDown: true }],
    });
    renderIntl(<StaffReportsView initialReports={[taken]} initialTakedowns={[]} />);
    expect(screen.getByText('Taken down')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take down this document' })).toBeNull();
  });

  it('take down the agent, confirmed: creates the agent takedown linked to the report', async () => {
    const createTakedown = vi.fn(async () => ({ ok: true as const, id: 'tkd_new' }));
    renderIntl(
      <StaffReportsView initialReports={[REPORT]} initialTakedowns={[]} createTakedown={createTakedown} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Take down this agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull());
    expect(createTakedown).toHaveBeenCalledWith({
      kind: 'agent',
      targetId: 'agt_1',
      category: 'harmful',
      reportId: 'rp_1',
    });
  });

  it('no "take down this agent" button when the report has no agent id', () => {
    renderIntl(
      <StaffReportsView
        initialReports={[report({ id: 'rp_4', agentId: null })]}
        initialTakedowns={[]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Take down this agent' })).toBeNull();
  });

  it('a message that is gone shows the fallback line, not a crash', () => {
    renderIntl(
      <StaffReportsView initialReports={[report({ id: 'rp_5', message: null })]} initialTakedowns={[]} />,
    );
    expect(screen.getByText('This message is no longer available.')).toBeInTheDocument();
  });

  it('while any action is in flight every button is disabled', async () => {
    renderIntl(
      <StaffReportsView
        initialReports={[REPORT]}
        initialTakedowns={[]}
        reviewReport={never}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
  });

  it.each([
    ['forbidden', "You can't do that: your staff access may have changed."],
    ['not_found', 'That was not found. Reload the list.'],
    ['validation', 'This was already actioned or is no longer open. Reload the list.'],
    ['provider_error', 'Something went wrong. Try again.'],
  ] as const)('an error reply (%s) keeps the row and re-enables the button', async (code, message) => {
    const reviewReport = vi.fn(async () => ({ ok: false as const, code }));
    renderIntl(<StaffReportsView initialReports={[REPORT]} initialTakedowns={[]} reviewReport={reviewReport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
  });

  it('a thrown review call still resets the busy flag', async () => {
    const reviewReport = vi.fn(async () => {
      throw new Error('boom');
    });
    renderIntl(<StaffReportsView initialReports={[REPORT]} initialTakedowns={[]} reviewReport={reviewReport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
  });

  it('lists an active takedown and lifts it (no confirm step)', async () => {
    const liftTakedown = vi.fn(async () => ({ ok: true as const, id: 'tkd_1' }));
    renderIntl(
      <StaffReportsView initialReports={[]} initialTakedowns={[TAKEDOWN]} liftTakedown={liftTakedown} />,
    );
    expect(screen.getByText('Document')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lift takedown on doc_1' }));
    await waitFor(() => expect(screen.queryByText('Document')).toBeNull());
    expect(liftTakedown).toHaveBeenCalledWith({ takedownId: 'tkd_1' });
  });

  it('a takedown row shows its target, category and when, and Lift names its target', () => {
    renderIntl(<StaffReportsView initialReports={[]} initialTakedowns={[TAKEDOWN]} />);
    expect(screen.getByText('doc_1')).toBeInTheDocument();
    expect(screen.getByText('Copyright')).toBeInTheDocument();
    expect(screen.getByText('Oct 22, 2026, 12:00 AM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lift takedown on doc_1' })).toBeInTheDocument();
  });

  it("two takedowns of the same kind for the same teacher get distinct Lift names (the review's ambiguity bug)", () => {
    const second = takedown({ id: 'tkd_2', targetId: 'doc_2' });
    renderIntl(
      <StaffReportsView initialReports={[]} initialTakedowns={[TAKEDOWN, second]} />,
    );
    expect(screen.getByRole('button', { name: 'Lift takedown on doc_1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lift takedown on doc_2' })).toBeInTheDocument();
  });

  it('the agent takedown button hides when that agent already has an active takedown', () => {
    const agentTakedown = takedown({ id: 'tkd_agent', kind: 'agent', targetId: 'agt_1' });
    renderIntl(
      <StaffReportsView initialReports={[REPORT]} initialTakedowns={[agentTakedown]} />,
    );
    expect(screen.queryByRole('button', { name: 'Take down this agent' })).toBeNull();
  });

  it('the takedown confirm text differs from the dismiss confirm text', () => {
    renderIntl(<StaffReportsView initialReports={[REPORT]} initialTakedowns={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take down this agent' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Takes it out of retrieval now; you can lift it below. Confirm?",
    );
  });

  it('reports the reported text as plain text: an embedded markdown link never becomes a live link', () => {
    const withLink = report({
      id: 'rp_link',
      message: {
        role: 'agent',
        text: 'See [this site](https://evil.test) for more.',
        createdAt: '2026-10-22T00:00:00.000Z',
      },
    });
    renderIntl(<StaffReportsView initialReports={[withLink]} initialTakedowns={[]} />);
    expect(
      screen.getByText('See [this site](https://evil.test) for more.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it("a 400 on an action says it was already actioned or no longer open", async () => {
    const reviewReport = vi.fn(async () => ({ ok: false as const, code: 'validation' as const }));
    renderIntl(<StaffReportsView initialReports={[REPORT]} initialTakedowns={[]} reviewReport={reviewReport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() =>
      expect(
        screen.getByText('This was already actioned or is no longer open. Reload the list.'),
      ).toBeInTheDocument(),
    );
  });

  it('a stale poll in flight when an action succeeds does not bring the dismissed report back', async () => {
    let resolvePoll: ((v: { ok: true; reports: ReportView[] }) => void) | null = null;
    const loadReports = vi.fn(
      () =>
        new Promise<{ ok: true; reports: ReportView[] }>((resolve) => {
          resolvePoll = resolve;
        }),
    );
    const reviewReport = vi.fn(async () => ({ ok: true as const, id: 'rp_1' }));
    renderIntl(
      <StaffReportsView
        initialReports={[REPORT]}
        initialTakedowns={[]}
        loadReports={loadReports}
        loadTakedowns={okTakedowns}
        reviewReport={reviewReport}
        pollMs={5}
      />,
    );
    // Let the poll start (and go in flight) before the action begins.
    await waitFor(() => expect(loadReports).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull());
    // The stale poll (still carrying the now-dismissed report) resolves after the action.
    resolvePoll!({ ok: true, reports: [REPORT] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('a poll clears only a stale loadFailed error, never an action error', async () => {
    const reviewReport = vi.fn(async () => ({ ok: false as const, code: 'provider_error' as const }));
    renderIntl(
      <StaffReportsView
        initialReports={[REPORT]}
        initialTakedowns={[]}
        reviewReport={reviewReport}
        loadReports={okReports}
        loadTakedowns={okTakedowns}
        pollMs={5}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText('Something went wrong. Try again.')).toBeInTheDocument();
  });

  it('a rejecting loader is caught: refresh never throws an unhandled rejection', async () => {
    const loadReports = vi.fn(async () => {
      throw new Error('network boom');
    });
    renderIntl(
      <StaffReportsView
        initialReports={null}
        initialTakedowns={null}
        loadReports={loadReports}
        loadTakedowns={okTakedowns}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(screen.getByText('Could not load the reports console. Try again.')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled();
  });

  it('announces a single open report in the singular, with no stray count in the fallback view', () => {
    renderIntl(<StaffReportsView initialReports={[REPORT]} initialTakedowns={[]} />);
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).toHaveTextContent('1 open report');
    expect(region).not.toHaveTextContent('1 open reports');
  });

  it('the fallback view (failed initial read) shows no open-report count at all', () => {
    renderIntl(<StaffReportsView initialReports={null} initialTakedowns={null} />);
    expect(document.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it('stops polling on unmount: no loader call lands after the component is gone', async () => {
    const loadReports = vi.fn(okReports);
    const { unmount } = renderIntl(
      <StaffReportsView
        initialReports={[REPORT]}
        initialTakedowns={[]}
        loadReports={loadReports}
        loadTakedowns={okTakedowns}
        pollMs={5}
      />,
    );
    unmount();
    loadReports.mockClear();
    await new Promise((r) => setTimeout(r, 40));
    expect(loadReports).not.toHaveBeenCalled();
  });

  it('a never-settling poll never overlaps itself: a far slower loader than pollMs is called exactly once', async () => {
    const loadReports = vi.fn(() => new Promise<never>(() => undefined));
    renderIntl(
      <StaffReportsView
        initialReports={[REPORT]}
        initialTakedowns={[]}
        loadReports={loadReports}
        loadTakedowns={okTakedowns}
        pollMs={5}
      />,
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(loadReports).toHaveBeenCalledTimes(1);
  });

  it('manual reload: loads the latest lists and clears a previous error', async () => {
    const reviewReport = vi.fn(async () => ({ ok: false as const, code: 'provider_error' as const }));
    const loadReports = vi.fn(async () => ({ ok: true as const, reports: [] }));
    const loadTakedowns = vi.fn(async () => ({ ok: true as const, takedowns: [TAKEDOWN] }));
    renderIntl(
      <StaffReportsView
        initialReports={[REPORT]}
        initialTakedowns={[]}
        reviewReport={reviewReport}
        loadReports={loadReports}
        loadTakedowns={loadTakedowns}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByText('Something went wrong. Try again.')).toBeNull());
    expect(screen.getByText('Document')).toBeInTheDocument();
  });

  it('a null initial (the server reads failed) is the fallback view, recoverable with Reload', async () => {
    const loadReports = vi.fn(async () => ({ ok: true as const, reports: [REPORT] }));
    const loadTakedowns = vi.fn(async () => ({ ok: true as const, takedowns: [] }));
    renderIntl(
      <StaffReportsView
        initialReports={null}
        initialTakedowns={null}
        loadReports={loadReports}
        loadTakedowns={loadTakedowns}
      />,
    );
    expect(screen.getByText('Could not load the reports console. Try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('listitem')).toBeInTheDocument());
    expect(screen.queryByText('Could not load the reports console. Try again.')).toBeNull();
  });

  it('polls on schedule and refreshes both lists; a poll failure after a good load is quiet', async () => {
    const other = report({ id: 'rp_other', message: { role: 'agent', text: 'second reply', createdAt: '2026-10-22T00:00:00.000Z' } });
    const loadReports = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, reports: [other] })
      .mockResolvedValue({ ok: false, code: 'provider_error' });
    renderIntl(
      <StaffReportsView
        initialReports={[REPORT]}
        initialTakedowns={[]}
        loadReports={loadReports}
        loadTakedowns={okTakedowns}
        pollMs={10}
      />,
    );
    await waitFor(() => expect(loadReports).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('second reply')).toBeInTheDocument());
    expect(screen.queryByText('Something went wrong. Try again.')).toBeNull();
  });

  it('a pending action pauses polling: no refresh call lands mid-action', async () => {
    const loadReports = vi.fn(okReports);
    renderIntl(
      <StaffReportsView
        initialReports={[REPORT]}
        initialTakedowns={[]}
        reviewReport={never}
        loadReports={loadReports}
        loadTakedowns={okTakedowns}
        pollMs={5}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled());
    await new Promise((r) => setTimeout(r, 40));
    expect(loadReports).not.toHaveBeenCalled();
  });

  it('has no axe violations (list, fallback and empty views)', async () => {
    for (const [reports, takedowns] of [
      [[REPORT, REPORT_WITH_DOC], [TAKEDOWN]],
      [null, null],
      [[], []],
    ] as const) {
      const { container, unmount } = renderIntl(
        <StaffReportsView initialReports={reports} initialTakedowns={takedowns} />,
      );
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });
});
