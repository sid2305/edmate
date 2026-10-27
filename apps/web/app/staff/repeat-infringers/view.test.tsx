// @vitest-environment jsdom
// Task 12.3d: the repeat-infringer list view. A trimmed `StaffQueueView` (no lookup form): a
// server-shape failure is the fallback view, recoverable with Reload; approving/rejecting a row
// removes it from the list and resets the busy flag whatever the outcome; axe checks the list,
// empty and fallback states.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import type { LookupItem } from '../client';
import { StaffRepeatInfringersView } from './view';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

function teacher(o: Partial<LookupItem> & { teacherId: string; slug: string }): LookupItem {
  return {
    displayName: o.slug,
    subject: 'Math',
    name: 'Asha K',
    email: 'asha@example.test',
    activeTakedowns: [],
    lastDecision: null,
    subjectHistory: [],
    verificationStatus: 'verified',
    ...o,
  };
}

const ASHA = teacher({ teacherId: 'tch_a', slug: 'asha-math' });

const never = () => new Promise<never>(() => undefined);

describe('StaffRepeatInfringersView', () => {
  it('lists each flagged teacher by slug', () => {
    renderIntl(<StaffRepeatInfringersView initial={[ASHA]} />);
    const row = within(screen.getByRole('list')).getByRole('listitem');
    expect(row).toHaveTextContent('asha-math');
  });

  it('a wrong-shape initial value falls back, recoverable with Reload', async () => {
    const loadFlagged = vi.fn(async () => ({ ok: true as const, teachers: [ASHA] }));
    renderIntl(<StaffRepeatInfringersView initial={{ oops: true }} loadFlagged={loadFlagged} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/verification queue/i);
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    await waitFor(() => expect(screen.getByRole('list')).toBeInTheDocument());
  });

  it('the empty state shows when there are no flagged teachers', () => {
    renderIntl(<StaffRepeatInfringersView initial={[]} />);
    expect(screen.getByText(/no teachers are currently flagged/i)).toBeInTheDocument();
  });

  it('rejecting a row removes it from the list and shows the notice', async () => {
    const decide = vi.fn(async () => ({
      ok: true as const,
      verificationStatus: 'rejected' as const,
    }));
    renderIntl(<StaffRepeatInfringersView initial={[ASHA]} decide={decide} />);
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    await waitFor(() => expect(screen.queryByRole('list')).toBeNull());
    expect(decide).toHaveBeenCalledWith({
      teacherId: 'tch_a',
      status: 'rejected',
      reason: '',
      safety: false,
    });
    expect(screen.getByRole('status')).toHaveTextContent('asha-math was rejected.');
  });

  it('a decide failure resets the busy flag and shows the error, keeping the row', async () => {
    const decide = vi.fn(async () => ({ ok: false as const, code: 'forbidden' as const }));
    renderIntl(<StaffRepeatInfringersView initial={[ASHA]} decide={decide} />);
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).not.toBeDisabled();
  });

  it('a pending decide call disables the row while it is in flight', async () => {
    const decide = vi.fn(never);
    renderIntl(<StaffRepeatInfringersView initial={[ASHA]} decide={decide} />);
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    await waitFor(() => expect(screen.getByText('Saving…')).toBeDisabled());
  });

  it('a failed reload keeps the fallback error', async () => {
    const loadFlagged = vi.fn(async () => ({
      ok: false as const,
      code: 'provider_error' as const,
    }));
    renderIntl(<StaffRepeatInfringersView initial={[ASHA]} loadFlagged={loadFlagged} />);
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/verification queue/i));
  });

  it('axe: the list state has no violations', async () => {
    const { container } = renderIntl(<StaffRepeatInfringersView initial={[ASHA]} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('axe: the empty state has no violations', async () => {
    const { container } = renderIntl(<StaffRepeatInfringersView initial={[]} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('axe: the fallback state has no violations', async () => {
    const { container } = renderIntl(<StaffRepeatInfringersView initial={null} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
