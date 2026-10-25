// @vitest-environment jsdom
// Task 12.1b: the staff verification console. Rows leave the list after a decision; every action
// resets its busy flag (success, error reply, or a thrown call); a server payload of the wrong
// shape shows the fallback view, never a crash.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import type { QueueItem } from './client';
import { StaffQueueView } from './view';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const ASHA: QueueItem = {
  teacherId: 'tch_a',
  slug: 'asha-math',
  subject: 'Math',
  name: 'Asha Rao',
  email: 'asha@example.test',
};
const BEN: QueueItem = { teacherId: 'tch_b', slug: 'ben-physics', subject: 'Physics', name: 'Ben', email: null };

const SAFETY_LABEL =
  "Safety concern: also stop every student's access to this teacher's agent now";
const SAFETY_HINT =
  'Use this only for a safety reason. Students who already subscribed lose access at once; a paperwork rejection leaves them until their plan ends.';

const never = () => new Promise<never>(() => undefined);

function rowOf(slug: string) {
  return screen.getByRole('listitem', { name: slug });
}

describe('StaffQueueView', () => {
  it('lists each pending teacher with slug, subject, declared name and email', () => {
    renderIntl(<StaffQueueView initial={[ASHA, BEN]} />);
    const asha = rowOf('asha-math');
    expect(within(asha).getByText('Math')).toBeInTheDocument();
    expect(within(asha).getByText('Asha Rao')).toBeInTheDocument();
    expect(within(asha).getByText('asha@example.test')).toBeInTheDocument();
    expect(within(rowOf('ben-physics')).getByText('No email on file')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is pending', () => {
    renderIntl(<StaffQueueView initial={[]} />);
    expect(screen.getByText('No teachers are waiting for verification.')).toBeInTheDocument();
  });

  it('approve: sends the decision, the row leaves the list, a notice shows', async () => {
    const decide = vi.fn(async () => ({ ok: true as const, verificationStatus: 'verified' as const }));
    renderIntl(<StaffQueueView initial={[ASHA, BEN]} decide={decide} />);
    fireEvent.click(within(rowOf('asha-math')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'asha-math' })).toBeNull());
    expect(decide).toHaveBeenCalledWith({
      teacherId: 'tch_a',
      status: 'verified',
      reason: '',
      safety: false,
    });
    expect(screen.getByRole('status')).toHaveTextContent('asha-math is now verified.');
    expect(within(rowOf('ben-physics')).getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('reject with a reason: the reason is sent and the row leaves', async () => {
    const decide = vi.fn(async () => ({ ok: true as const, verificationStatus: 'rejected' as const }));
    renderIntl(<StaffQueueView initial={[ASHA]} decide={decide} />);
    const row = rowOf('asha-math');
    fireEvent.change(within(row).getByLabelText('Reason (optional)'), {
      target: { value: 'Name does not match' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('asha-math was rejected.'));
    expect(decide).toHaveBeenCalledWith({
      teacherId: 'tch_a',
      status: 'rejected',
      reason: 'Name does not match',
      safety: false,
    });
    expect(screen.getByText('No teachers are waiting for verification.')).toBeInTheDocument();
  });

  it('safety concern + Reject sends `safety: true` and shows the safety notice (9.3e)', async () => {
    const decide = vi.fn(async () => ({ ok: true as const, verificationStatus: 'rejected' as const }));
    renderIntl(<StaffQueueView initial={[ASHA, BEN]} decide={decide} />);
    const row = rowOf('asha-math');
    const box = within(row).getByRole('checkbox', { name: SAFETY_LABEL });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(SAFETY_HINT);
    fireEvent.click(box);
    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'asha-math was rejected and their agent is no longer available to students.',
      ),
    );
    expect(decide).toHaveBeenCalledWith({
      teacherId: 'tch_a',
      status: 'rejected',
      reason: '',
      safety: true,
    });
  });

  it('Approve never sends the safety flag, even with the box ticked (9.3e)', async () => {
    const decide = vi.fn(async () => ({ ok: true as const, verificationStatus: 'verified' as const }));
    renderIntl(<StaffQueueView initial={[ASHA]} decide={decide} />);
    const row = rowOf('asha-math');
    fireEvent.click(within(row).getByRole('checkbox', { name: SAFETY_LABEL }));
    fireEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('asha-math is now verified.'),
    );
    expect(decide).toHaveBeenCalledWith({
      teacherId: 'tch_a',
      status: 'verified',
      reason: '',
      safety: false,
    });
  });

  it('a safety box ticked then unticked is a plain rejection (9.3e)', async () => {
    const decide = vi.fn(async () => ({ ok: true as const, verificationStatus: 'rejected' as const }));
    renderIntl(<StaffQueueView initial={[ASHA]} decide={decide} />);
    const row = rowOf('asha-math');
    const box = within(row).getByRole('checkbox', { name: SAFETY_LABEL });
    fireEvent.click(box);
    fireEvent.click(box);
    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('asha-math was rejected.'));
    expect(screen.getByRole('status')).not.toHaveTextContent('no longer available');
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ safety: false }));
  });

  it('while a decision is in flight every action is disabled and the row says so', async () => {
    renderIntl(<StaffQueueView initial={[ASHA, BEN]} decide={never} />);
    fireEvent.click(within(rowOf('asha-math')).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(within(rowOf('asha-math')).getByRole('button', { name: 'Saving…' })).toBeDisabled(),
    );
    expect(within(rowOf('ben-physics')).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
  });

  it.each([
    ['forbidden', "You can't verify this teacher: it may be your own profile, or your staff access changed."],
    ['not_found', 'That teacher was not found. Reload the list.'],
    ['validation', 'Check the reason (up to 500 characters) and try again.'],
    ['provider_error', 'Something went wrong. Try again.'],
  ] as const)('an error reply (%s) keeps the row, shows a message and re-enables the buttons', async (code, message) => {
    const decide = vi.fn(async () => ({ ok: false as const, code }));
    renderIntl(<StaffQueueView initial={[ASHA]} decide={decide} />);
    fireEvent.click(within(rowOf('asha-math')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
    expect(within(rowOf('asha-math')).getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(within(rowOf('asha-math')).getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('a decide call that throws still resets the busy flag', async () => {
    const decide = vi.fn(async () => {
      throw new Error('boom');
    });
    renderIntl(<StaffQueueView initial={[ASHA]} decide={decide} />);
    fireEvent.click(within(rowOf('asha-math')).getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.'),
    );
    expect(within(rowOf('asha-math')).getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('the next action clears an old error and notice', async () => {
    const decide = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'provider_error' })
      .mockReturnValueOnce(never());
    renderIntl(<StaffQueueView initial={[ASHA]} decide={decide} />);
    fireEvent.click(within(rowOf('asha-math')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    fireEvent.click(within(rowOf('asha-math')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('an initial payload of the wrong shape shows the fallback view with a reload', async () => {
    const loadQueue = vi.fn(async () => ({ ok: true as const, teachers: [BEN] }));
    renderIntl(<StaffQueueView initial={[{ teacherId: 7 }]} loadQueue={loadQueue} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the verification queue.');
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(rowOf('ben-physics')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a null initial (the server read failed) is the fallback view too', () => {
    renderIntl(<StaffQueueView initial={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the verification queue.');
  });

  it('reload: an error reply or a throw shows the load error and re-enables Reload', async () => {
    const loadQueue = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'forbidden' })
      .mockRejectedValueOnce(new Error('boom'));
    renderIntl(<StaffQueueView initial={[ASHA]} loadQueue={loadQueue} />);
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Could not load the verification queue.'),
      );
      expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled();
      // The last good list stays on screen.
      expect(rowOf('asha-math')).toBeInTheDocument();
    }
  });

  it('reload shows its busy label while in flight', async () => {
    renderIntl(<StaffQueueView initial={[ASHA]} loadQueue={never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reloading…' })).toBeDisabled());
  });

  it('has no axe violations (list, fallback and empty views)', async () => {
    for (const initial of [[ASHA, BEN], null, []]) {
      const { container, unmount } = renderIntl(<StaffQueueView initial={initial} />);
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });
});

describe('StaffQueueView: find a teacher by slug (9.3f)', () => {
  const VERIFIED = { ...ASHA, verificationStatus: 'verified' as const };

  it('shows a verified teacher with its current status, Approve/Reject and a safety checkbox', async () => {
    const findTeacherBySlug = vi.fn(async () => ({ ok: true as const, teacher: VERIFIED }));
    renderIntl(<StaffQueueView initial={[]} findTeacherBySlug={findTeacherBySlug} />);
    fireEvent.change(screen.getByLabelText('Find a teacher by their profile URL'), {
      target: { value: 'asha-math' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(rowOf('asha-math')).toBeInTheDocument());
    expect(findTeacherBySlug).toHaveBeenCalledWith('asha-math');
    const row = rowOf('asha-math');
    expect(within(row).getByText('Verified')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(within(row).getByRole('checkbox', { name: SAFETY_LABEL })).toBeInTheDocument();
  });

  it('safety concern + Reject on the found row sends safety: true, clears it, shows rejectedSafety', async () => {
    const findTeacherBySlug = vi.fn(async () => ({ ok: true as const, teacher: VERIFIED }));
    const decide = vi.fn(async () => ({ ok: true as const, verificationStatus: 'rejected' as const }));
    renderIntl(
      <StaffQueueView initial={[]} findTeacherBySlug={findTeacherBySlug} decide={decide} />,
    );
    fireEvent.change(screen.getByLabelText('Find a teacher by their profile URL'), {
      target: { value: 'asha-math' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(rowOf('asha-math')).toBeInTheDocument());
    const row = rowOf('asha-math');
    fireEvent.click(within(row).getByRole('checkbox', { name: SAFETY_LABEL }));
    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'asha-math was rejected and their agent is no longer available to students.',
      ),
    );
    expect(decide).toHaveBeenCalledWith({
      teacherId: 'tch_a',
      status: 'rejected',
      reason: '',
      safety: true,
    });
    expect(screen.queryByRole('listitem', { name: 'asha-math' })).toBeNull();
  });

  it('an unknown slug shows lookupNotFound, no row', async () => {
    const findTeacherBySlug = vi.fn(async () => ({ ok: true as const, teacher: null }));
    renderIntl(<StaffQueueView initial={[]} findTeacherBySlug={findTeacherBySlug} />);
    fireEvent.change(screen.getByLabelText('Find a teacher by their profile URL'), {
      target: { value: 'no-such-teacher' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() =>
      expect(screen.getByText('No teacher has that profile URL.')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('finding again after an unknown slug replaces lookupNotFound with the found row', async () => {
    const findTeacherBySlug = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, teacher: null })
      .mockResolvedValueOnce({ ok: true, teacher: VERIFIED });
    renderIntl(<StaffQueueView initial={[]} findTeacherBySlug={findTeacherBySlug} />);
    const input = screen.getByLabelText('Find a teacher by their profile URL');
    fireEvent.change(input, { target: { value: 'no-such-teacher' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() =>
      expect(screen.getByText('No teacher has that profile URL.')).toBeInTheDocument(),
    );
    fireEvent.change(input, { target: { value: 'asha-math' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(rowOf('asha-math')).toBeInTheDocument());
    expect(screen.queryByText('No teacher has that profile URL.')).toBeNull();
  });

  it('Find is disabled while a blank or whitespace-only slug is entered', () => {
    renderIntl(<StaffQueueView initial={[]} />);
    expect(screen.getByRole('button', { name: 'Find' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Find a teacher by their profile URL'), {
      target: { value: '   ' },
    });
    expect(screen.getByRole('button', { name: 'Find' })).toBeDisabled();
  });

  it('a find error reply shows the message and does not crash', async () => {
    const findTeacherBySlug = vi.fn(async () => ({ ok: false as const, code: 'provider_error' as const }));
    renderIntl(<StaffQueueView initial={[]} findTeacherBySlug={findTeacherBySlug} />);
    fireEvent.change(screen.getByLabelText('Find a teacher by their profile URL'), {
      target: { value: 'asha-math' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.'),
    );
  });

  it('a find call that throws still resets the busy flag', async () => {
    const findTeacherBySlug = vi.fn(async () => {
      throw new Error('boom');
    });
    renderIntl(<StaffQueueView initial={[]} findTeacherBySlug={findTeacherBySlug} />);
    fireEvent.change(screen.getByLabelText('Find a teacher by their profile URL'), {
      target: { value: 'asha-math' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.'),
    );
    expect(screen.getByRole('button', { name: 'Find' })).toBeEnabled();
  });

  it('the pending queue list never shows a current-status line (only lookup results do)', () => {
    renderIntl(<StaffQueueView initial={[ASHA]} />);
    expect(screen.queryByText('Current status')).toBeNull();
  });

  it('has no axe violations with a found row and a not-found message', async () => {
    const findTeacherBySlug = vi.fn(async () => ({ ok: true as const, teacher: VERIFIED }));
    const { container } = renderIntl(
      <StaffQueueView initial={[BEN]} findTeacherBySlug={findTeacherBySlug} />,
    );
    fireEvent.change(screen.getByLabelText('Find a teacher by their profile URL'), {
      target: { value: 'asha-math' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(rowOf('asha-math')).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});
