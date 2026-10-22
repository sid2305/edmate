// @vitest-environment jsdom
// Task 12.5c: the staff alert inbox. Escalated/overdue rows sort first and show the marker; an
// acknowledged alert leaves the open list; every action resets its busy flag (success, error
// reply, or a thrown call); a server payload of the wrong shape shows the fallback view, never a
// crash; polling is paused while an action is in flight. A tiny `pollMs` (as in the publish view's
// own tests) lets the polling tests use the real clock, no fake timers.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import type { AlertView } from './client';
import { StaffAlertView } from './view';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const NOW = Date.now();

function alert(o: Partial<AlertView> & { id: string }): AlertView {
  return {
    level: 'alert',
    kind: 'distress',
    studentId: 'stu_1',
    teacherId: 'tch_a',
    sessionId: 'ses_1',
    teacherSlug: 'asha-math',
    excerptRedacted: 'synthetic excerpt',
    createdAt: new Date(NOW - 5 * 60_000).toISOString(),
    receivedAt: new Date(NOW - 5 * 60_000).toISOString(),
    escalatedAt: null,
    escalationRound: 0,
    lastPagedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    ackNote: null,
    overdue: false,
    ...o,
  };
}

const QUIET = alert({ id: 'alr_quiet' });
const ESCALATED = alert({
  id: 'alr_escalated',
  createdAt: new Date(NOW - 20 * 60_000).toISOString(),
  escalatedAt: new Date(NOW - 5 * 60_000).toISOString(),
  escalationRound: 1,
});
const OVERDUE = alert({
  id: 'alr_overdue',
  createdAt: new Date(NOW - 16 * 60_000).toISOString(),
  overdue: true,
});

const never = () => new Promise<never>(() => undefined);

describe('StaffAlertView', () => {
  it('lists each open alert with kind, teacher slug and excerpt', () => {
    renderIntl(<StaffAlertView initial={[QUIET]} />);
    const row = within(screen.getByRole('list')).getByRole('listitem');
    expect(within(row).getByText('Distress')).toBeInTheDocument();
    expect(within(row).getByText('asha-math')).toBeInTheDocument();
    expect(within(row).getByText('synthetic excerpt')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is open', () => {
    renderIntl(<StaffAlertView initial={[]} />);
    expect(screen.getByText('No open safety alerts.')).toBeInTheDocument();
  });

  it('escalated and overdue rows sort first, oldest first, each with the marker', () => {
    renderIntl(<StaffAlertView initial={[QUIET, OVERDUE, ESCALATED]} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByRole('alert')).toHaveTextContent(
      'Escalated: unacknowledged for 20 min, on-call paged 1 times',
    );
    expect(within(items[1]!).getByRole('alert')).toHaveTextContent(
      'Escalated: unacknowledged for 16 min, on-call paged 0 times',
    );
    expect(within(items[2]!).queryByRole('alert')).toBeNull();
  });

  it('acknowledge: sends the note, the row leaves the list, a notice shows', async () => {
    const acknowledge = vi.fn(async () => ({ ok: true as const, acknowledged: true }));
    renderIntl(<StaffAlertView initial={[QUIET]} acknowledge={acknowledge} />);
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'checked on student' } });
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull());
    expect(acknowledge).toHaveBeenCalledWith({ alertId: 'alr_quiet', note: 'checked on student' });
    expect(screen.getByRole('status')).toHaveTextContent('Acknowledged.');
  });

  it('while an ack is in flight every action is disabled', async () => {
    renderIntl(<StaffAlertView initial={[QUIET, ESCALATED]} acknowledge={never} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Acknowledge' })[0]!);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Acknowledging…' })[0]).toBeDisabled(),
    );
    expect(screen.getAllByRole('button', { name: 'Acknowledge' })[0]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
  });

  it.each([
    ['forbidden', "You can't acknowledge this alert: your staff access may have changed."],
    ['not_found', 'That alert was not found. Reload the list.'],
    ['validation', 'Check the note (up to 500 characters) and try again.'],
    ['provider_error', 'Something went wrong. Try again.'],
  ] as const)('an error reply (%s) keeps the row and re-enables the button', async (code, message) => {
    const acknowledge = vi.fn(async () => ({ ok: false as const, code }));
    renderIntl(<StaffAlertView initial={[QUIET]} acknowledge={acknowledge} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeEnabled();
  });

  it('a thrown acknowledge still resets the busy flag', async () => {
    const acknowledge = vi.fn(async () => {
      throw new Error('boom');
    });
    renderIntl(<StaffAlertView initial={[QUIET]} acknowledge={acknowledge} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeEnabled();
  });

  it('manual reload: loads the latest list and clears a previous error', async () => {
    const acknowledge = vi.fn(async () => ({ ok: false as const, code: 'provider_error' as const }));
    const loadAlerts = vi.fn(async () => ({ ok: true as const, alerts: [ESCALATED] }));
    renderIntl(<StaffAlertView initial={[QUIET]} acknowledge={acknowledge} loadAlerts={loadAlerts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByText('Something went wrong. Try again.')).toBeNull());
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });

  it('a null initial (the server read failed) is the fallback view, recoverable with Reload', async () => {
    const loadAlerts = vi.fn(async () => ({ ok: true as const, alerts: [QUIET] }));
    renderIntl(<StaffAlertView initial={null} loadAlerts={loadAlerts} />);
    expect(screen.getByText('Could not load the alert inbox. Try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('listitem')).toBeInTheDocument());
    expect(screen.queryByText('Could not load the alert inbox. Try again.')).toBeNull();
  });

  it('polls on schedule and refreshes the list; a poll failure after a good load is quiet', async () => {
    const other = alert({ id: 'alr_other', excerptRedacted: 'second excerpt' });
    const loadAlerts = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, alerts: [other] })
      .mockResolvedValue({ ok: false, code: 'provider_error' });
    renderIntl(<StaffAlertView initial={[QUIET]} loadAlerts={loadAlerts} pollMs={10} />);
    await waitFor(() => expect(loadAlerts).toHaveBeenCalledWith('open'));
    await waitFor(() => expect(screen.getByText('second excerpt')).toBeInTheDocument());
    expect(screen.queryByText('Something went wrong. Try again.')).toBeNull();
  });

  it('a pending ack pauses polling: no refresh call lands mid-action', async () => {
    const loadAlerts = vi.fn(async () => ({ ok: true as const, alerts: [QUIET] }));
    renderIntl(<StaffAlertView initial={[QUIET]} acknowledge={never} loadAlerts={loadAlerts} pollMs={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled());
    await new Promise((r) => setTimeout(r, 40));
    expect(loadAlerts).not.toHaveBeenCalled();
  });

  it('has no axe violations (list, fallback and empty views)', async () => {
    for (const initial of [[QUIET, ESCALATED], null, []]) {
      const { container, unmount } = renderIntl(<StaffAlertView initial={initial} />);
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });
});
