// @vitest-environment jsdom
// Task 11.2b: `submitClassQuestion` is injected (rule 4: no real network); a malformed or
// non-200 reply must show an error and re-enable the form (lessons: "a studio page that trusts a
// 200 response gets stuck").
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import { AskQuestionForm } from './AskQuestionForm';

describe('AskQuestionForm', () => {
  it('sends the trimmed question and shows a confirmation, clearing the input', async () => {
    const submitClassQuestion = vi.fn(async () => ({ ok: true as const, id: 'cq_1' }));
    renderIntl(<AskQuestionForm liveClassId="lc_1" submitClassQuestion={submitClassQuestion} />);
    fireEvent.change(screen.getByLabelText('Ask your teacher a question before class'), {
      target: { value: '  What is a ratio?  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(submitClassQuestion).toHaveBeenCalledWith('lc_1', 'What is a ratio?'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your question was sent.'));
    expect((screen.getByLabelText('Ask your teacher a question before class') as HTMLInputElement).value).toBe('');
  });

  it('a blank question is a validation error, nothing sent', () => {
    const submitClassQuestion = vi.fn();
    renderIntl(<AskQuestionForm liveClassId="lc_1" submitClassQuestion={submitClassQuestion} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(submitClassQuestion).not.toHaveBeenCalled();
  });

  it('a malformed 200 reply (a thrown error) does not leave the button stuck disabled', async () => {
    const submitClassQuestion = vi.fn(async () => {
      throw new Error('bad body');
    });
    renderIntl(<AskQuestionForm liveClassId="lc_1" submitClassQuestion={submitClassQuestion} />);
    fireEvent.change(screen.getByLabelText('Ask your teacher a question before class'), {
      target: { value: 'hi' },
    });
    const button = screen.getByRole('button', { name: 'Send question' });
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('a non-200 result shows an error and re-enables the form', async () => {
    const submitClassQuestion = vi.fn(async () => ({
      ok: false as const,
      code: 'not_found' as const,
      retryable: false,
    }));
    renderIntl(<AskQuestionForm liveClassId="lc_1" submitClassQuestion={submitClassQuestion} />);
    fireEvent.change(screen.getByLabelText('Ask your teacher a question before class'), {
      target: { value: 'hi' },
    });
    const button = screen.getByRole('button', { name: 'Send question' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.'));
    expect(button).not.toBeDisabled();
  });
});
