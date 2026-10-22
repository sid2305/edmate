// @vitest-environment jsdom
// Task 11.1b Phase B: the live classes studio view. `scheduleLiveClass` is injected (rule 4: no
// real network); a malformed or non-200 reply must show an error and re-enable the form
// (lessons: "a studio page that trusts a 200 response gets stuck").
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import { LiveClassesView } from './LiveClassesView';

const PACKAGES = [{ packageId: 'pkg_1', name: 'Grade 8 Math' }];

function fillForm() {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Ratios review' } });
  fireEvent.change(screen.getByLabelText('Join link (https://…)'), {
    target: { value: 'https://meet.example.com/abc' },
  });
  fireEvent.change(screen.getByLabelText('Start time'), {
    target: { value: '2026-11-01T10:00' },
  });
  fireEvent.click(screen.getByLabelText('Grade 8 Math'));
}

describe('LiveClassesView', () => {
  it('shows the empty state when there are no classes yet', () => {
    renderIntl(<LiveClassesView classes={[]} packages={PACKAGES} />);
    expect(screen.getByText('No live classes scheduled yet.')).toBeInTheDocument();
  });

  it('shows an existing scheduled class', () => {
    renderIntl(
      <LiveClassesView
        classes={[
          {
            id: 'lc_1',
            title: 'Ratios review',
            link: 'https://meet.example.com/abc',
            startsAt: '2026-11-01T10:00:00.000Z',
            packageIds: ['pkg_1'],
          },
        ]}
        packages={PACKAGES}
      />,
    );
    expect(screen.getByText('Ratios review')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join link' })).toHaveAttribute(
      'href',
      'https://meet.example.com/abc',
    );
    expect(screen.getByRole('link', { name: 'Join link' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Join link' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });

  it('schedules a class and adds it to the list, clearing the form', async () => {
    const scheduleLiveClass = vi.fn(async () => ({ ok: true as const, id: 'lc_new' }));
    renderIntl(
      <LiveClassesView classes={[]} packages={PACKAGES} scheduleLiveClass={scheduleLiveClass} />,
    );
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule class' }));
    await waitFor(() => expect(scheduleLiveClass).toHaveBeenCalled());
    expect(scheduleLiveClass).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ratios review',
        link: 'https://meet.example.com/abc',
        packageIds: ['pkg_1'],
      }),
    );
    await waitFor(() => expect(screen.getByText('The class is scheduled.')).toBeInTheDocument());
    expect(screen.getByText('Ratios review')).toBeInTheDocument();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');
  });

  it('a missing field is a validation error, nothing sent', () => {
    const scheduleLiveClass = vi.fn();
    renderIntl(
      <LiveClassesView classes={[]} packages={PACKAGES} scheduleLiveClass={scheduleLiveClass} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Schedule class' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Check the title, link, start time and packages, and try again.',
    );
    expect(scheduleLiveClass).not.toHaveBeenCalled();
  });

  it('a malformed 200 reply does not leave the button stuck disabled', async () => {
    const scheduleLiveClass = vi.fn(async () => {
      throw new Error('bad body');
    });
    renderIntl(
      <LiveClassesView classes={[]} packages={PACKAGES} scheduleLiveClass={scheduleLiveClass} />,
    );
    fillForm();
    const button = screen.getByRole('button', { name: 'Schedule class' });
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('a failed schedule shows an error and re-enables the form', async () => {
    const scheduleLiveClass = vi.fn(async () => ({
      ok: false as const,
      code: 'provider_error' as const,
      retryable: true,
    }));
    renderIntl(
      <LiveClassesView classes={[]} packages={PACKAGES} scheduleLiveClass={scheduleLiveClass} />,
    );
    fillForm();
    const button = screen.getByRole('button', { name: 'Schedule class' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.'));
    expect(button).not.toBeDisabled();
  });
});
