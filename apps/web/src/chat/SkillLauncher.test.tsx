// @vitest-environment jsdom
// Task 9.5a/9.5b: the skill launcher -- Practice, the feedback toggle, and the mock-interview
// persona picker.
import { fireEvent, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import { SkillLauncher } from './SkillLauncher';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

function setup(overrides: Partial<Parameters<typeof SkillLauncher>[0]> = {}) {
  const onStartPractice = vi.fn();
  const onToggleFeedback = vi.fn();
  const onStartMockInterview = vi.fn();
  const view = renderIntl(
    <SkillLauncher
      disabled={false}
      onStartPractice={onStartPractice}
      feedbackActive={false}
      onToggleFeedback={onToggleFeedback}
      onStartMockInterview={onStartMockInterview}
      {...overrides}
    />,
  );
  return { view, onStartPractice, onToggleFeedback, onStartMockInterview };
}

describe('SkillLauncher', () => {
  it('calls onStartPractice when the Practice button is clicked', async () => {
    const { view, onStartPractice } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    expect(onStartPractice).toHaveBeenCalledTimes(1);
    expect(await axe(view.container)).toHaveNoViolations();
  });

  it('disables every button while a reply streams', () => {
    setup({ disabled: true });
    expect(screen.getByRole('button', { name: 'Practice' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Get feedback' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Job interview' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Viva' })).toBeDisabled();
  });

  it('calls onToggleFeedback when the feedback toggle is clicked, and reflects its pressed state', () => {
    const { onToggleFeedback } = setup({ feedbackActive: true });
    const toggle = screen.getByRole('button', { name: 'Get feedback' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(onToggleFeedback).toHaveBeenCalledTimes(1);
  });

  it('calls onStartMockInterview with the chosen persona id', () => {
    const { onStartMockInterview } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Job interview' }));
    expect(onStartMockInterview).toHaveBeenCalledWith('job-interview');
    fireEvent.click(screen.getByRole('button', { name: 'Viva' }));
    expect(onStartMockInterview).toHaveBeenCalledWith('viva');
  });
});
