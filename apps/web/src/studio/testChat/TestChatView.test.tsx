// @vitest-environment jsdom
// Task 8.5 Phase C: the teacher test chat over fake start/send/correct clients (rule 4: no real
// network or model). A send starts a preview session on the picked package; a finished reply can
// be marked wrong, and the correction form submits {moduleId, question, badAnswer,
// correctedAnswer}; a failed or thrown save shows an error and never leaves the form stuck.
import type { TurnEvent } from '@edmate/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import type { SendTurnOptions, StartSessionResult } from '../../chat/sendTurn';
import type { CorrectionInput, CorrectionResult } from './sendTestTurn';
import { TestChatView, type TestChatViewProps } from './TestChatView';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const NOW = new Date('2026-10-22T10:00:00.000Z');
const PACKAGES = [
  { packageId: 'pkg_1', name: 'Starter' },
  { packageId: 'pkg_2', name: 'Exam prep' },
];
const MODULES = [
  { id: 'mod_1', title: 'Fractions' },
  { id: 'mod_2', title: 'Decimals' },
];

function setup(opts: Partial<Pick<TestChatViewProps, 'modules'>> & {
  start?: () => Promise<StartSessionResult>;
  correct?: (input: CorrectionInput) => Promise<CorrectionResult>;
} = {}) {
  const calls: (SendTurnOptions & { aborted: boolean })[] = [];
  const send = vi.fn((o: SendTurnOptions) => {
    const call = { ...o, aborted: false };
    calls.push(call);
    return {
      abort: () => {
        call.aborted = true;
      },
      done: new Promise<void>(() => {}),
    };
  });
  let n = 0;
  const start = vi.fn(
    opts.start ?? (async (): Promise<StartSessionResult> => ({ ok: true, sessionId: `ses_${++n}` })),
  );
  const correct = vi.fn(
    opts.correct ?? (async (): Promise<CorrectionResult> => ({ ok: true, correctionId: 'cor_1' })),
  );
  const view = renderIntl(
    <TestChatView
      agentId="agt_a"
      packages={PACKAGES}
      modules={opts.modules ?? MODULES}
      start={start}
      send={send}
      correct={correct}
      now={() => NOW}
    />,
  );
  const last = () => {
    const c = calls.at(-1);
    if (c === undefined) throw new Error('no turn sent');
    return c;
  };
  const push = (...events: TurnEvent[]) =>
    act(() => {
      for (const event of events) last().onItem({ kind: 'event', event });
    });
  return { view, send, start, correct, calls, push };
}

async function type(text: string) {
  const box = screen.getByRole('textbox', { name: 'Your message' });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

const tok = (text: string): TurnEvent => ({ type: 'token', text });
const done: TurnEvent = { type: 'done', messageId: 'msg_9', usage: [] };

async function finishedReply(s: ReturnType<typeof setup>, question: string, answer: string) {
  const before = s.calls.length;
  await type(question);
  await waitFor(() => expect(s.calls).toHaveLength(before + 1));
  s.push(tok(answer), done);
}

// Heavy jsdom renders: a longer per-test timeout so a loaded CI runner doesn't time out a passing test.
describe('TestChatView', { timeout: 20_000 }, () => {
  it('starts a preview session on the picked package and sends the turn to it', async () => {
    const s = setup();
    await type('What is 1/2 + 1/4?');
    await waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
    expect(s.start).toHaveBeenCalledWith('agt_a', 'pkg_1');
    expect(s.calls[0]).toMatchObject({
      sessionId: 'ses_1',
      body: { agentId: 'agt_a', kind: 'message', text: 'What is 1/2 + 1/4?', lang: 'en', clientTs: NOW.toISOString() },
    });
    // A second send reuses the session.
    s.push(tok('3/4'), done);
    await type('And 1/3 + 1/3?');
    await waitFor(() => expect(s.send).toHaveBeenCalledTimes(2));
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(s.calls[1]?.sessionId).toBe('ses_1');
  });

  it('a streaming reply has no "Mark wrong"; a finished one does', async () => {
    const s = setup();
    await type('Q');
    await waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
    s.push(tok('partial'));
    expect(screen.queryByRole('button', { name: 'Mark wrong' })).toBeNull();
    s.push(done);
    expect(screen.getByRole('button', { name: 'Mark wrong' })).toBeInTheDocument();
  });

  it('marks a reply wrong and submits the correction with the right payload, then confirms', async () => {
    const s = setup();
    await finishedReply(s, 'What is 1/2 + 1/4?', 'It is 2/6.');
    fireEvent.click(screen.getByRole('button', { name: 'Mark wrong' }));
    const form = screen.getByRole('form', { name: 'Correct this answer' });
    expect(within(form).getByRole('textbox', { name: 'Student question' })).toHaveValue('What is 1/2 + 1/4?');
    expect(within(form).getByText('It is 2/6.')).toBeInTheDocument();
    const save = within(form).getByRole('button', { name: 'Save correction' });
    expect(save).toBeDisabled();
    fireEvent.change(within(form).getByRole('combobox', { name: 'Module' }), { target: { value: 'mod_2' } });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Correct answer' }), {
      target: { value: '  It is 3/4.  ' },
    });
    fireEvent.click(save);
    await waitFor(() => expect(s.correct).toHaveBeenCalledTimes(1));
    expect(s.correct).toHaveBeenCalledWith({
      moduleId: 'mod_2',
      question: 'What is 1/2 + 1/4?',
      badAnswer: 'It is 2/6.',
      correctedAnswer: 'It is 3/4.',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Correction saved.');
    expect(screen.queryByRole('form', { name: 'Correct this answer' })).toBeNull();
  });

  it('the teacher can edit the question before saving', async () => {
    const s = setup();
    await finishedReply(s, 'Q1', 'A1');
    fireEvent.click(screen.getByRole('button', { name: 'Mark wrong' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Student question' }), { target: { value: 'Better Q' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Correct answer' }), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(s.correct).toHaveBeenCalledWith(expect.objectContaining({ question: 'Better Q', moduleId: 'mod_1' })));
  });

  it('an earlier reply keeps its own question and answer after the next turn', async () => {
    const s = setup();
    await finishedReply(s, 'First Q', 'First A');
    await type('Second Q');
    await waitFor(() => expect(s.send).toHaveBeenCalledTimes(2));
    s.push(tok('Second A'), done);
    const buttons = screen.getAllByRole('button', { name: 'Mark wrong' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(screen.getByRole('textbox', { name: 'Student question' })).toHaveValue('First Q');
    fireEvent.change(screen.getByRole('textbox', { name: 'Correct answer' }), { target: { value: 'Fixed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() =>
      expect(s.correct).toHaveBeenCalledWith({ moduleId: 'mod_1', question: 'First Q', badAnswer: 'First A', correctedAnswer: 'Fixed' }),
    );
  });

  it('an open form stays with its reply when the next turn starts', async () => {
    const s = setup();
    await finishedReply(s, 'First Q', 'First A');
    fireEvent.click(screen.getByRole('button', { name: 'Mark wrong' }));
    await type('Second Q');
    await waitFor(() => expect(s.send).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('textbox', { name: 'Student question' })).toHaveValue('First Q');
  });

  it.each([
    ['validation', { ok: false, code: 'validation', retryable: false } as const, 'couldn\'t be saved'],
    ['not_found', { ok: false, code: 'not_found', retryable: false } as const, "isn't yours any more"],
    ['provider_error', { ok: false, code: 'provider_error', retryable: true } as const, 'Something went wrong'],
  ])('a %s save shows its error and the form stays usable', async (_code, result, text) => {
    const s = setup({ correct: async () => result });
    await finishedReply(s, 'Q', 'A');
    fireEvent.click(screen.getByRole('button', { name: 'Mark wrong' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Correct answer' }), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    const form = screen.getByRole('form', { name: 'Correct this answer' });
    expect(await within(form).findByRole('alert')).toHaveTextContent(text);
    expect(within(form).getByRole('button', { name: 'Save correction' })).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a thrown save is a generic error, not a stuck "Saving…" button', async () => {
    const s = setup({ correct: async () => Promise.reject(new Error('boom')) });
    await finishedReply(s, 'Q', 'A');
    fireEvent.click(screen.getByRole('button', { name: 'Mark wrong' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Correct answer' }), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled();
  });

  it('shows "Saving…" while the save is in flight', async () => {
    let resolve: (r: CorrectionResult) => void = () => {};
    const s = setup({ correct: () => new Promise<CorrectionResult>((r) => (resolve = r)) });
    await finishedReply(s, 'Q', 'A');
    fireEvent.click(screen.getByRole('button', { name: 'Mark wrong' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Correct answer' }), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => resolve({ ok: true, correctionId: 'cor_1' }));
    expect(screen.getByRole('status')).toHaveTextContent('Correction saved.');
  });

  it('cancel closes the form without saving', async () => {
    const s = setup();
    await finishedReply(s, 'Q', 'A');
    fireEvent.click(screen.getByRole('button', { name: 'Mark wrong' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Correct this answer' })).toBeNull();
    expect(s.correct).not.toHaveBeenCalled();
  });

  it('with no modules the form says so and cannot be saved', async () => {
    const s = setup({ modules: [] });
    await finishedReply(s, 'Q', 'A');
    fireEvent.click(screen.getByRole('button', { name: 'Mark wrong' }));
    expect(screen.getByText(/Add a module to your course outline/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Correct answer' }), { target: { value: 'B' } });
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
  });

  it('switching package aborts the turn, clears the thread and starts a new session on it', async () => {
    const s = setup();
    await type('Q');
    await waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
    s.push(tok('streaming…'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Package' }), { target: { value: 'pkg_2' } });
    expect(s.calls[0]?.aborted).toBe(true);
    expect(screen.queryByText('Q')).toBeNull();
    expect(screen.getByText('Ask your first question below.')).toBeInTheDocument();
    // A late item for the old turn is ignored.
    act(() => s.calls[0]?.onItem({ kind: 'event', event: tok('late') }));
    expect(screen.queryByText(/late/)).toBeNull();
    await type('Q2');
    await waitFor(() => expect(s.send).toHaveBeenCalledTimes(2));
    expect(s.start).toHaveBeenLastCalledWith('agt_a', 'pkg_2');
    expect(s.calls[1]?.sessionId).toBe('ses_2');
  });

  it('a failed session start shows fixed error text with a retry', async () => {
    const results: StartSessionResult[] = [
      { ok: false, code: 'provider_error', retryable: true },
      { ok: true, sessionId: 'ses_ok' },
    ];
    const s = setup({ start: async () => results.shift() as StartSessionResult });
    await type('Q');
    const alert = await screen.findByRole('alert');
    expect(s.send).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
    expect(s.calls[0]?.sessionId).toBe('ses_ok');
  });

  it('a thrown session start is an error, never a stuck turn', async () => {
    const s = setup({ start: async () => Promise.reject(new Error('offline')) });
    await type('Q');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
    expect(s.send).not.toHaveBeenCalled();
  });

  it('a hint request is sent as a hint turn', async () => {
    const s = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Get a hint' }));
    await waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
    expect(s.calls[0]?.body).toMatchObject({ kind: 'hint_request' });
  });

  it('has no axe violations with an open correction form', async () => {
    const s = setup();
    await finishedReply(s, 'Q', 'A');
    fireEvent.click(screen.getByRole('button', { name: 'Mark wrong' }));
    expect(await axe(s.view.container)).toHaveNoViolations();
  });
});
