// @vitest-environment jsdom
// Task 9.5b: the mock-interview Pause/Stop controls.
import { fireEvent, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import { MockInterviewControls, parseRolePlayProgress } from './MockInterviewControls';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

describe('MockInterviewControls', () => {
  it('calls onPause and onStop when clicked', async () => {
    const onPause = vi.fn();
    const onStop = vi.fn();
    const view = renderIntl(
      <MockInterviewControls disabled={false} onPause={onPause} onStop={onStop} progress={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(await axe(view.container)).toHaveNoViolations();
  });

  it('disables both buttons while a reply streams', () => {
    renderIntl(<MockInterviewControls disabled={true} onPause={vi.fn()} onStop={vi.fn()} progress={null} />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  });

  it('shows no progress line when progress is null', () => {
    renderIntl(<MockInterviewControls disabled={false} onPause={vi.fn()} onStop={vi.fn()} progress={null} />);
    expect(document.querySelector('.chat-mock-interview-progress')).toBeNull();
  });

  it.each([
    [{ phase: 'question', question: 3, total: 6 }, 'Question 3 of 6'],
    [{ phase: 'resume', question: 2, total: 6 }, 'Question 2 of 6'],
    [{ phase: 'pause', question: 2, total: 6 }, 'Paused — question 2 of 6'],
    [{ phase: 'debrief', total: 6 }, 'Interview complete — 6 questions asked'],
    [{ phase: 'debrief', total: 1 }, 'Interview complete — 1 question asked'],
    [{ phase: 'stopped', answered: 4 }, 'Interview stopped — 4 question(s) answered'],
    [{ phase: 'ended' }, 'Interview ended'],
  ] as const)('renders the %s progress line', (progress, text) => {
    renderIntl(<MockInterviewControls disabled={false} onPause={vi.fn()} onStop={vi.fn()} progress={progress} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('announces the progress line to screen readers via role="status"', () => {
    renderIntl(
      <MockInterviewControls
        disabled={false}
        onPause={vi.fn()}
        onStop={vi.fn()}
        progress={{ phase: 'question', question: 3, total: 6 }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Question 3 of 6');
  });

  it('parseRolePlayProgress rejects an unparseable payload instead of throwing', () => {
    expect(parseRolePlayProgress(null)).toBeNull();
    expect(parseRolePlayProgress({ phase: 'question' })).toBeNull();
    expect(parseRolePlayProgress({ phase: 'not-a-phase' })).toBeNull();
    expect(parseRolePlayProgress({ phase: 'question', question: 1, total: 6 })).toEqual({
      phase: 'question',
      question: 1,
      total: 6,
    });
  });
});
