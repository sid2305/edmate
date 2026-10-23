// @vitest-environment jsdom
// Task 12.4d: the staff regulated-subject console. Saving a subject commits the row's own select
// state; approving or revoking needs a confirm step; every action resets its busy flag (success,
// error reply, or a thrown call); a server payload of the wrong shape shows the fallback view,
// never a crash.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import type { AgentView } from './client';
import { StaffAgentsView } from './view';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

function agent(o: Partial<AgentView> & { agentId: string }): AgentView {
  return {
    teacherSlug: 'asha-math',
    status: 'draft',
    liveVersion: null,
    regulatedSubject: null,
    approvedAt: null,
    approvedBy: null,
    ...o,
  };
}

const UNFLAGGED = agent({ agentId: 'agt_plain' });
const FLAGGED = agent({ agentId: 'agt_flagged', regulatedSubject: 'health' });
const APPROVED = agent({
  agentId: 'agt_approved',
  regulatedSubject: 'law',
  approvedAt: '2026-10-20T10:00:00.000Z',
  approvedBy: 'stf_1',
});

const never = () => new Promise<never>(() => undefined);

describe('StaffAgentsView', () => {
  it('lists each agent with teacher slug and status', () => {
    renderIntl(<StaffAgentsView initial={[UNFLAGGED]} />);
    const row = within(screen.getByRole('list')).getByRole('listitem');
    expect(within(row).getByText('asha-math')).toBeInTheDocument();
    expect(within(row).getByText('Draft')).toBeInTheDocument();
  });

  it('shows the empty state when there are no agents', () => {
    renderIntl(<StaffAgentsView initial={[]} />);
    expect(screen.getByText('No agents yet.')).toBeInTheDocument();
  });

  it('an unflagged agent has no approve/revoke action', () => {
    renderIntl(<StaffAgentsView initial={[UNFLAGGED]} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('shows the approved date for an approved agent', () => {
    renderIntl(<StaffAgentsView initial={[APPROVED]} />);
    expect(screen.getByText('2026-10-20T10:00:00.000Z')).toBeInTheDocument();
  });

  it('save subject: sends the new subject, clears approval locally, shows a notice', async () => {
    const setSubject = vi.fn(async () => ({ ok: true as const, changed: true }));
    renderIntl(<StaffAgentsView initial={[UNFLAGGED]} setSubject={setSubject} />);
    fireEvent.change(screen.getByLabelText('Regulated subject'), { target: { value: 'health' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setSubject).toHaveBeenCalledWith({ agentId: 'agt_plain', subject: 'health' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('save is disabled until the select differs from the stored subject', () => {
    renderIntl(<StaffAgentsView initial={[FLAGGED]} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('approve: a confirm step first, then the call', async () => {
    const setApproval = vi.fn(async () => ({ ok: true as const, changed: true }));
    renderIntl(<StaffAgentsView initial={[FLAGGED]} setApproval={setApproval} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(setApproval).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Approve this agent to publish with its current subject?');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(setApproval).toHaveBeenCalledWith({ agentId: 'agt_flagged', approved: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
  });

  it('approve: cancel keeps it unapproved and makes no call', () => {
    const setApproval = vi.fn();
    renderIntl(<StaffAgentsView initial={[FLAGGED]} setApproval={setApproval} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(setApproval).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('revoke: a confirm step first, then the call', async () => {
    const setApproval = vi.fn(async () => ({ ok: true as const, changed: true }));
    renderIntl(<StaffAgentsView initial={[APPROVED]} setApproval={setApproval} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(screen.getByRole('alert').textContent).toContain('Revoke approval?');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(setApproval).toHaveBeenCalledWith({ agentId: 'agt_approved', approved: false }));
  });

  it('cancel returns keyboard focus to the row action button', () => {
    renderIntl(<StaffAgentsView initial={[FLAGGED]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveFocus();
  });

  it('confirm returns keyboard focus to the row action button once the call settles', async () => {
    const setApproval = vi.fn(async () => ({ ok: true as const, changed: true }));
    renderIntl(<StaffAgentsView initial={[FLAGGED]} setApproval={setApproval} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toHaveFocus());
  });

  it('approval takes approvedBy from the reload reply, not the stale pre-action prop', async () => {
    const setApproval = vi.fn(async () => ({ ok: true as const, changed: true }));
    const APPROVED_BY_SERVER = agent({
      agentId: 'agt_flagged',
      regulatedSubject: 'health',
      approvedAt: '2026-10-22T11:00:00.000Z',
      approvedBy: 'stf_9',
    });
    const loadAgents = vi.fn(async () => ({ ok: true as const, agents: [APPROVED_BY_SERVER] }));
    renderIntl(
      <StaffAgentsView initial={[FLAGGED]} setApproval={setApproval} loadAgents={loadAgents} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(loadAgents).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('2026-10-22T11:00:00.000Z')).toBeInTheDocument());
  });

  it('approve: the whole row takes the reloaded record (status, teacher slug), not just approval fields', async () => {
    const setApproval = vi.fn(async () => ({ ok: true as const, changed: true }));
    const FRESH = agent({
      agentId: 'agt_flagged',
      teacherSlug: 'asha-math-v2',
      status: 'live',
      liveVersion: 3,
      regulatedSubject: 'health',
      approvedAt: '2026-10-22T11:00:00.000Z',
      approvedBy: 'stf_9',
    });
    const loadAgents = vi.fn(async () => ({ ok: true as const, agents: [FRESH] }));
    renderIntl(<StaffAgentsView initial={[FLAGGED]} setApproval={setApproval} loadAgents={loadAgents} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(screen.getByText('asha-math-v2')).toBeInTheDocument());
    const row = within(screen.getByRole('list')).getByRole('listitem');
    expect(within(row).getByText('Live')).toBeInTheDocument();
    expect(within(row).queryByText('Draft')).toBeNull();
    expect(within(row).getByText('2026-10-22T11:00:00.000Z')).toBeInTheDocument();
  });

  it('revoke: the whole row takes the reloaded record (status, teacher slug), not just approval fields', async () => {
    const setApproval = vi.fn(async () => ({ ok: true as const, changed: true }));
    const FRESH = agent({
      agentId: 'agt_approved',
      teacherSlug: 'ravi-law',
      status: 'suspended',
      liveVersion: 2,
      regulatedSubject: 'law',
    });
    const loadAgents = vi.fn(async () => ({ ok: true as const, agents: [FRESH] }));
    renderIntl(<StaffAgentsView initial={[APPROVED]} setApproval={setApproval} loadAgents={loadAgents} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(screen.getByText('ravi-law')).toBeInTheDocument());
    const row = within(screen.getByRole('list')).getByRole('listitem');
    expect(within(row).getByText('Suspended')).toBeInTheDocument();
    expect(within(row).queryByText('asha-math')).toBeNull();
    expect(within(row).queryByText('2026-10-20T10:00:00.000Z')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('a dirty, unsaved edit on one row survives a reload that only changes another row', async () => {
    const OTHER_BEFORE = agent({ agentId: 'agt_other', regulatedSubject: 'investing' });
    const OTHER_AFTER = agent({
      agentId: 'agt_other',
      regulatedSubject: 'investing',
      approvedAt: '2026-10-22T12:00:00.000Z',
      approvedBy: 'stf_3',
    });
    const loadAgents = vi.fn(async () => ({ ok: true as const, agents: [FLAGGED, OTHER_AFTER] }));
    renderIntl(
      <StaffAgentsView initial={[FLAGGED, OTHER_BEFORE]} loadAgents={loadAgents} />,
    );
    const flaggedSelect = screen.getAllByLabelText('Regulated subject')[0];
    if (!flaggedSelect) throw new Error('expected at least one subject select');
    fireEvent.change(flaggedSelect, { target: { value: 'law' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByText('2026-10-22T12:00:00.000Z')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Law')).toBeInTheDocument();
  });

  it('while an action is in flight every row action is disabled', async () => {
    renderIntl(<StaffAgentsView initial={[FLAGGED, UNFLAGGED]} setApproval={never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
  });

  it.each([
    ['forbidden', "You can't change this agent: your staff access may have changed."],
    ['not_found', 'That agent was not found. Reload the list.'],
    ['validation', 'Check the request and try again.'],
    ['provider_error', 'Something went wrong. Try again.'],
  ] as const)('an error reply (%s) re-enables the button', async (code, message) => {
    const setSubject = vi.fn(async () => ({ ok: false as const, code }));
    renderIntl(<StaffAgentsView initial={[UNFLAGGED]} setSubject={setSubject} />);
    fireEvent.change(screen.getByLabelText('Regulated subject'), { target: { value: 'health' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('a thrown call still resets the busy flag', async () => {
    const setSubject = vi.fn(async () => {
      throw new Error('boom');
    });
    renderIntl(<StaffAgentsView initial={[UNFLAGGED]} setSubject={setSubject} />);
    fireEvent.change(screen.getByLabelText('Regulated subject'), { target: { value: 'health' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('manual reload: loads the latest list and clears a previous error', async () => {
    const setSubject = vi.fn(async () => ({ ok: false as const, code: 'provider_error' as const }));
    const loadAgents = vi.fn(async () => ({ ok: true as const, agents: [FLAGGED] }));
    renderIntl(<StaffAgentsView initial={[UNFLAGGED]} setSubject={setSubject} loadAgents={loadAgents} />);
    fireEvent.change(screen.getByLabelText('Regulated subject'), { target: { value: 'health' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByText('Something went wrong. Try again.')).toBeNull());
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });

  it('reload resyncs a row to the fresh server subject/approval instead of keeping stale local state', async () => {
    const CHANGED = agent({
      agentId: 'agt_flagged',
      regulatedSubject: 'law',
      approvedAt: '2026-10-22T09:00:00.000Z',
      approvedBy: 'stf_2',
    });
    const loadAgents = vi.fn(async () => ({ ok: true as const, agents: [CHANGED] }));
    renderIntl(<StaffAgentsView initial={[FLAGGED]} loadAgents={loadAgents} />);
    expect(screen.getByLabelText('Regulated subject')).toHaveValue('health');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByLabelText('Regulated subject')).toHaveValue('law'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('a null initial (the server read failed) is the fallback view, recoverable with Reload', async () => {
    const loadAgents = vi.fn(async () => ({ ok: true as const, agents: [UNFLAGGED] }));
    renderIntl(<StaffAgentsView initial={null} loadAgents={loadAgents} />);
    expect(screen.getByText('Could not load the agent list. Try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('listitem')).toBeInTheDocument());
    expect(screen.queryByText('Could not load the agent list. Try again.')).toBeNull();
  });

  it('has no axe violations (list, fallback and empty views)', async () => {
    for (const initial of [[FLAGGED, APPROVED], null, []]) {
      const { container, unmount } = renderIntl(<StaffAgentsView initial={initial} />);
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });
});
