// @vitest-environment jsdom
// Task 8.9 Phase C: the questions inbox view. `answerGroup`/`dismissQuestion` are injected (rule
// 4: no real network); a failed call must show an error and re-enable the buttons (lessons: "a
// studio page that trusts a 200 response gets stuck").
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import { QuestionsInboxView, type InboxGroup } from './QuestionsInboxView';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const MODULES = [{ id: 'mod_1', title: 'Fractions' }];

const GROUP: InboxGroup = {
  groupId: 'grp_1',
  count: 2,
  oldestAt: '2026-10-20T00:00:00.000Z',
  questions: [
    { id: 'q_1', text: 'What is a fraction?', createdAt: '2026-10-20T00:00:00.000Z' },
    { id: 'q_2', text: 'What is a fraction exactly?', createdAt: '2026-10-21T00:00:00.000Z' },
  ],
};

describe('QuestionsInboxView', () => {
  it('shows the empty state when there are no open groups', () => {
    renderIntl(<QuestionsInboxView groups={[]} modules={MODULES} />);
    expect(screen.getByText('No open questions right now.')).toBeInTheDocument();
  });

  it('shows every group with its member question texts, never a student id', () => {
    renderIntl(<QuestionsInboxView groups={[GROUP]} modules={MODULES} />);
    expect(screen.getByText('What is a fraction?')).toBeInTheDocument();
    expect(screen.getByText('What is a fraction exactly?')).toBeInTheDocument();
    expect(screen.getByText('Asked by 2 students')).toBeInTheDocument();
  });

  it('sends an answer with the picked module and the whole group drops off the list', async () => {
    const answerGroup = vi.fn(async () => ({ ok: true as const, answered: 2, students: 2 }));
    const dismissQuestion = vi.fn();
    renderIntl(
      <QuestionsInboxView
        groups={[GROUP]}
        modules={MODULES}
        answerGroup={answerGroup}
        dismissQuestion={dismissQuestion}
      />,
    );
    fireEvent.change(screen.getByLabelText('Your answer'), {
      target: { value: 'A part of a whole.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() =>
      expect(answerGroup).toHaveBeenCalledWith({
        questionId: 'q_1',
        moduleId: 'mod_1',
        answer: 'A part of a whole.',
      }),
    );
    await waitFor(() => expect(screen.queryByText('What is a fraction?')).not.toBeInTheDocument());
    expect(screen.getByText('Answer sent to every student who asked.')).toBeInTheDocument();
    expect(screen.getByText('No open questions right now.')).toBeInTheDocument();
  });

  it('dismisses one question only; its sibling stays open', async () => {
    const dismissQuestion = vi.fn(async () => ({ ok: true as const }));
    renderIntl(
      <QuestionsInboxView groups={[GROUP]} modules={MODULES} dismissQuestion={dismissQuestion} />,
    );
    const row = screen.getByText('What is a fraction?').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(dismissQuestion).toHaveBeenCalledWith('q_1'));
    await waitFor(() => expect(screen.queryByText('What is a fraction?')).not.toBeInTheDocument());
    expect(screen.getByText('What is a fraction exactly?')).toBeInTheDocument();
    expect(screen.getByText('Question dismissed.')).toBeInTheDocument();
  });

  it('a failed answer shows an error and re-enables the button', async () => {
    const answerGroup = vi.fn(async () => ({
      ok: false as const,
      code: 'provider_error' as const,
      retryable: true,
    }));
    renderIntl(
      <QuestionsInboxView groups={[GROUP]} modules={MODULES} answerGroup={answerGroup} />,
    );
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'An answer.' } });
    const button = screen.getByRole('button', { name: 'Send answer' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(button).not.toBeDisabled();
    expect(screen.getByText('What is a fraction?')).toBeInTheDocument();
  });

  it('a failed dismiss shows an error and the question stays listed', async () => {
    const dismissQuestion = vi.fn(async () => ({
      ok: false as const,
      code: 'not_found' as const,
      retryable: false,
    }));
    renderIntl(
      <QuestionsInboxView groups={[GROUP]} modules={MODULES} dismissQuestion={dismissQuestion} />,
    );
    const row = screen.getByText('What is a fraction?').closest('li') as HTMLElement;
    const button = within(row).getByRole('button', { name: 'Dismiss' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.getByRole('alert')).toHaveTextContent("That question isn't there any more. Reload the page.");
    expect(button).not.toBeDisabled();
    expect(screen.getByText('What is a fraction?')).toBeInTheDocument();
  });

  it('refuses to send an empty answer without calling the backend', async () => {
    const answerGroup = vi.fn();
    renderIntl(
      <QuestionsInboxView groups={[GROUP]} modules={MODULES} answerGroup={answerGroup} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(answerGroup).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = renderIntl(<QuestionsInboxView groups={[GROUP]} modules={MODULES} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
