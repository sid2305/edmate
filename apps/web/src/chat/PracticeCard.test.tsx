// @vitest-environment jsdom
// Task 9.5a: the practice card renders the real `practice.next_item` output shape and collects a
// typed answer; the answer key never reaches this component.
import { fireEvent, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import { PracticeCard, type PracticeCardData } from './PracticeCard';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const numeric: PracticeCardData = {
  id: 'itm_1',
  kind: 'numeric',
  level: 1,
  prompt: 'What is 2 + 2?',
};

const mcq: PracticeCardData = {
  id: 'itm_2',
  kind: 'mcq',
  level: 2,
  prompt: 'Pick the fraction equal to a half.',
  options: ['1/4', '1/2', '3/4'],
};

describe('PracticeCard', () => {
  it('renders the prompt and a numeric answer form; submits trimmed text', async () => {
    const onAnswer = vi.fn();
    const view = renderIntl(<PracticeCard item={numeric} onAnswer={onAnswer} disabled={false} />);
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
    const input = screen.getByLabelText('Your answer');
    fireEvent.change(input, { target: { value: '  4  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(onAnswer).toHaveBeenCalledWith('4');
    expect(await axe(view.container)).toHaveNoViolations();
  });

  it('renders mcq options with no answer form', () => {
    renderIntl(<PracticeCard item={mcq} onAnswer={vi.fn()} disabled={false} />);
    expect(screen.getByText('Pick the fraction equal to a half.')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your answer')).toBeNull();
  });

  it('a short item also shows the answer form', () => {
    renderIntl(
      <PracticeCard
        item={{ id: 'itm_3', kind: 'short', level: 1, prompt: 'Name a prime number.' }}
        onAnswer={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByLabelText('Your answer')).toBeInTheDocument();
  });

  it('the submit button is disabled while the answer is blank', () => {
    renderIntl(<PracticeCard item={numeric} onAnswer={vi.fn()} disabled={false} />);
    expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
  });

  it('the answer form is disabled while the turn streams', () => {
    const onAnswer = vi.fn();
    renderIntl(<PracticeCard item={numeric} onAnswer={onAnswer} disabled={true} />);
    expect(screen.getByLabelText('Your answer')).toBeDisabled();
    const button = screen.getByRole('button', { name: 'Submit answer' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('never calls onAnswer with blank or whitespace-only text', () => {
    const onAnswer = vi.fn();
    renderIntl(<PracticeCard item={numeric} onAnswer={onAnswer} disabled={false} />);
    const input = screen.getByLabelText('Your answer');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
