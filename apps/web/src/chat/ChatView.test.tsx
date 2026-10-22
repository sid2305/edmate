// @vitest-environment jsdom
// Task 9.4 Phase C: the chat view over a fake `sendTurn` that the test drives event by event.
// Streamed text is provisional and outside the live region until `done`; `replace ''` clears what
// was shown; a cut stream leaves no agent text; the composer is disabled while a reply streams.
import type { TurnEvent } from '@edmate/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import { ChatView, type ChatMessage } from './ChatView';
import type { SendTurnOptions, StartSessionResult } from './sendTurn';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const NOW = new Date('2026-10-20T10:00:00.000Z');

function fakeSend() {
  const calls: (SendTurnOptions & { aborted: boolean })[] = [];
  const send = vi.fn((opts: SendTurnOptions) => {
    const call = { ...opts, aborted: false };
    calls.push(call);
    return {
      abort: () => {
        call.aborted = true;
      },
      done: new Promise<void>(() => {}),
    };
  });
  const last = () => {
    const c = calls.at(-1);
    if (c === undefined) throw new Error('no turn sent');
    return c;
  };
  return {
    send,
    calls,
    push: (...events: TurnEvent[]) =>
      act(() => {
        for (const event of events) last().onItem({ kind: 'event', event });
      }),
    end: () => act(() => last().onItem({ kind: 'ended' })),
  };
}

function setup(opts: { sessionId?: string | null; history?: ChatMessage[]; start?: () => Promise<StartSessionResult> } = {}) {
  const f = fakeSend();
  const start = vi.fn(opts.start ?? (async (): Promise<StartSessionResult> => ({ ok: true, sessionId: 'ses_new' })));
  const view = renderIntl(
    <ChatView
      agentId="agt_a"
      sessionId={opts.sessionId === undefined ? 'ses_1' : opts.sessionId}
      history={opts.history ?? []}
      send={f.send}
      start={start}
      now={() => NOW}
    />,
  );
  return { ...f, start, view };
}

const live = () => {
  const region = document.querySelector('[aria-live="polite"]');
  if (region === null) throw new Error('no live region');
  return region as HTMLElement;
};

function type(text: string) {
  const box = screen.getByRole('textbox', { name: 'Your message' });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

const tok = (text: string): TurnEvent => ({ type: 'token', text });
const done: TurnEvent = { type: 'done', messageId: 'msg_9', usage: [] };

describe('ChatView', () => {
  it('shows history: the student, the tutor and the teacher (labelled), withheld text literal', async () => {
    const { view } = setup({
      history: [
        { id: 'm1', role: 'student', text: 'Hello' },
        { id: 'm2', role: 'agent', text: '[message withheld: guard_blocked]' },
        { id: 'm3', role: 'teacher', text: 'Class on Friday.' },
      ],
    });
    expect(live()).toHaveTextContent('Hello');
    expect(live()).toHaveTextContent('[message withheld: guard_blocked]');
    expect(screen.getByText('Your teacher')).toBeInTheDocument();
    expect(await axe(view.container)).toHaveNoViolations();
  });

  it('an empty chat invites the first question', () => {
    setup();
    expect(screen.getByText('Ask your first question below.')).toBeInTheDocument();
  });

  it('sends a message turn; streamed text is provisional, outside the live region, until done', async () => {
    const f = setup();
    type('What is a half?');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    expect(f.calls[0]?.sessionId).toBe('ses_1');
    expect(f.calls[0]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'message',
      text: 'What is a half?',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
    expect(live()).toHaveTextContent('What is a half?');
    f.push(tok('One of two '), tok('equal parts.'));
    const provisional = screen.getByText('One of two equal parts.').closest('.bubble');
    expect(provisional).toHaveAttribute('aria-busy', 'true');
    expect(live()).not.toContainElement(provisional as HTMLElement);
    expect(screen.getByText('Still checking…')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Get a hint' })).toBeDisabled();
    expect(await axe(f.view.container)).toHaveNoViolations();

    f.push(done);
    const final = screen.getByText('One of two equal parts.').closest('.bubble');
    expect(live()).toContainElement(final as HTMLElement);
    expect(final).not.toHaveAttribute('aria-busy');
    expect(screen.queryByText('Still checking…')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
    expect(await axe(f.view.container)).toHaveNoViolations();
  });

  it("replace '' clears the shown text, skill cards and sources; the retry is marked Updated", async () => {
    const f = setup();
    type('Explain fractions');
    await waitFor(() => expect(f.send).toHaveBeenCalled());
    f.push(
      tok('Wrong first try'),
      { type: 'skill', skill: 'practice', payload: { q: '<script>x</script>' } },
      { type: 'sources', items: [{ title: 'Old source', locator: 'p. 1', kind: 'material' }] },
    );
    expect(screen.getByText('Wrong first try')).toBeInTheDocument();
    expect(screen.getByText('Practice', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/Old source/)).toBeInTheDocument();

    f.push({ type: 'replace', text: '' });
    expect(screen.queryByText('Wrong first try')).toBeNull();
    expect(screen.queryByText('Practice', { selector: 'strong' })).toBeNull();
    expect(screen.queryByText(/Old source/)).toBeNull();

    f.push(tok('Second try.'), done);
    expect(live()).toHaveTextContent('Second try.');
    expect(live()).not.toHaveTextContent('Wrong first try');
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(await axe(f.view.container)).toHaveNoViolations();
  });

  it('a replace with text after shown tokens shows only the new text and the Updated marker', () => {
    const f = setup();
    type('Q');
    return waitFor(() => expect(f.send).toHaveBeenCalled()).then(() => {
      f.push(tok('Draft'), { type: 'replace', text: 'Checked answer.' }, done);
      expect(live()).toHaveTextContent('Checked answer.');
      expect(live()).not.toHaveTextContent('Draft');
      expect(screen.getByText('Updated')).toBeInTheDocument();
    });
  });

  it('a cut stream leaves no agent text and shows the fixed error with a retry', async () => {
    const f = setup();
    type('Tell me');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.push(tok('Partial answer'));
    f.end();
    expect(screen.queryByText('Partial answer')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
    expect(await axe(f.view.container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(f.calls[1]?.body).toMatchObject({ kind: 'message', text: 'Tell me' });
    expect(screen.queryByRole('alert')).toBeNull();
    // The student's message is not repeated in the thread.
    expect(screen.getAllByText('Tell me')).toHaveLength(1);
    f.push(tok('Full answer.'), done);
    expect(live()).toHaveTextContent('Full answer.');
  });

  it('an error event never shows server text, and a non-retryable one has no retry', () => {
    const f = setup();
    type('Bad');
    return waitFor(() => expect(f.send).toHaveBeenCalled()).then(() => {
      f.push(tok('x'), { type: 'error', code: 'guard_blocked', retryable: false });
      expect(screen.getByRole('alert')).toHaveTextContent("I can't help with that here.");
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(screen.queryByText('x')).toBeNull();
    });
  });

  it('the hint button sends a hint_request with no text and shows the rung label', async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Get a hint' }));
    await waitFor(() => expect(f.send).toHaveBeenCalled());
    expect(f.calls[0]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'hint_request',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
    expect(live()).toHaveTextContent('Can I have a hint?');
    f.push({ type: 'hint_rung', rung: 3 }, tok('Try halving.'), done);
    expect(screen.getByText('Last help: Worked example')).toBeInTheDocument();
  });

  it('shows the locked notice and the sent-to-your-teacher notice', async () => {
    const f = setup();
    type('Locked topic');
    await waitFor(() => expect(f.send).toHaveBeenCalled());
    f.push(
      { type: 'locked', packageName: 'Algebra Plus' },
      { type: 'teacher_question', questionId: 'tq_1' },
      tok('That is in another package.'),
      done,
    );
    expect(screen.getByText('This is part of Algebra Plus.')).toBeInTheDocument();
    expect(screen.getByText(/Sent to your teacher/)).toBeInTheDocument();
    expect(await axe(f.view.container)).toHaveNoViolations();
  });

  it('a second turn keeps the first reply in the thread', async () => {
    const f = setup();
    type('One');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.push(tok('First reply.'), done);
    type('Two');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    f.push(tok('Second reply.'), done);
    expect(live()).toHaveTextContent('First reply.');
    expect(live()).toHaveTextContent('Second reply.');
  });

  it('with no session it starts one, records it in the URL, then sends the turn', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    const f = setup({ sessionId: null });
    type('Hi');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    expect(f.start).toHaveBeenCalledWith('agt_a');
    expect(f.calls[0]?.sessionId).toBe('ses_new');
    expect(replace.mock.calls.at(-1)?.[2]).toBe('?s=ses_new');
    f.push(tok('Hello.'), done);
    type('Again');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(f.start).toHaveBeenCalledTimes(1);
    replace.mockRestore();
  });

  it('a failed session start shows the fixed error and sends nothing', async () => {
    const f = setup({ sessionId: null, start: async () => ({ ok: false, code: 'no_access', retryable: false }) });
    type('Hi');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('You need a live package with this teacher to chat.');
    expect(f.send).not.toHaveBeenCalled();
  });

  it('late items from an earlier turn are ignored', async () => {
    const f = setup();
    type('One');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    const first = f.calls[0];
    f.end();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(first?.aborted).toBe(true);
    act(() => first?.onItem({ kind: 'ended' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('aborts the turn on unmount', async () => {
    const f = setup();
    type('Bye');
    await waitFor(() => expect(f.send).toHaveBeenCalled());
    f.view.unmount();
    expect(f.calls[0]?.aborted).toBe(true);
  });

  const practiceItem = (id: string, prompt: string): TurnEvent => ({
    type: 'skill',
    skill: 'practice',
    payload: { id, kind: 'numeric', level: 1, prompt },
  });

  it('starting practice renders a dedicated PracticeCard, not the generic SkillCard', async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    expect(f.calls[0]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'message',
      text: "Let's practice.",
      skill: 'practice',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
    f.push(practiceItem('itm_1', 'What is 2 + 2?'), done);
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).toBeInTheDocument();
    expect(await axe(f.view.container)).toHaveNoViolations();
  });

  it("a practice answer is a check_answer tagged skill: 'practice'; a correct attempt shows a fresh item", async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.push(practiceItem('itm_1', 'What is 2 + 2?'), done);

    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(f.calls[1]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'check_answer',
      text: '4',
      skill: 'practice',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
    f.push(practiceItem('itm_2', 'What is 3 + 5?'), done);
    // A fresh item card, shown as this turn's own card (the earlier item stays in the thread's
    // history, same as any other past turn -- "a second turn keeps the first reply").
    expect(screen.getByText('What is 3 + 5?')).toBeInTheDocument();
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
  });

  it('a hint asked while a practice item is active also carries skill: practice', async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.push(practiceItem('itm_1', 'What is 2 + 2?'), done);

    fireEvent.click(screen.getByRole('button', { name: 'Get a hint' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(f.calls[1]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'hint_request',
      skill: 'practice',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
  });

  it('after a practice item, a plain Composer message carries no skill', async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.push(practiceItem('itm_1', 'What is 2 + 2?'), done);

    type('Something else');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(f.calls[1]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'message',
      text: 'Something else',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
  });

  it('after a final turn with no skill cards, a hint carries no skill', async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.push(practiceItem('itm_1', 'What is 2 + 2?'), done);

    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    f.push(tok('Well done, practice is over.'), done);

    fireEvent.click(screen.getByRole('button', { name: 'Get a hint' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(3));
    expect(f.calls[2]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'hint_request',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
  });

  it('a feedback submission carries skill: feedback once; the next plain message carries no skill', async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Get feedback' }));
    type('Here is my essay.');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    expect(f.calls[0]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'message',
      text: 'Here is my essay.',
      skill: 'feedback',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
    f.push(tok('Nice structure, but check your thesis.'), done);

    type('What about my conclusion?');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(f.calls[1]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'message',
      text: 'What about my conclusion?',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
  });

  it('starting the mock interview sends skill_action with the persona, and shows Pause/Stop', async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Job interview' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    expect(f.calls[0]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'skill_action',
      skill: 'mock_interview',
      skillPayload: { persona: 'job-interview' },
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
    f.push(tok('Tell me about yourself.'), done);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(await axe(f.view.container)).toHaveNoViolations();
  });

  it('a mock-interview answer typed in the Composer carries skill: mock_interview, no skillPayload', async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Viva' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.push(tok('Question one: explain recursion.'), done);

    type('Recursion is a function calling itself.');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(f.calls[1]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'message',
      text: 'Recursion is a function calling itself.',
      skill: 'mock_interview',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
  });

  it('/pause keeps the mock interview active; Stop clears it so the next message has no skill', async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Job interview' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.push(tok('Question one.'), done);

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(f.calls[1]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'message',
      text: '/pause',
      skill: 'mock_interview',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
    f.push(tok('Paused.'), done);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(3));
    expect(f.calls[2]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'message',
      text: 'stop',
      skill: 'mock_interview',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    f.push(tok('Debrief: good answers overall.'), done);

    type('Thanks!');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(4));
    expect(f.calls[3]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'message',
      text: 'Thanks!',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
  });

  it('a mock interview that comes back locked clears activeSkill: Pause/Stop hidden, next message has no skill', async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Job interview' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.push({ type: 'locked', packageName: 'Interview Prep' }, tok('That is in another package.'), done);
    expect(screen.getByText('This is part of Interview Prep.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();

    type('Can I try something else?');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(f.calls[1]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'message',
      text: 'Can I try something else?',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
  });

  it('a practice start that comes back locked also leaves the next message with no skill', async () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.push({ type: 'locked', packageName: 'Algebra Plus' }, tok('That is in another package.'), done);
    expect(screen.getByText('This is part of Algebra Plus.')).toBeInTheDocument();

    type('Something else');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(f.calls[1]?.body).toEqual({
      agentId: 'agt_a',
      kind: 'message',
      text: 'Something else',
      lang: 'en',
      clientTs: NOW.toISOString(),
    });
  });

  it('a practice payload with non-string options falls back to the generic SkillCard', async () => {
    const f = setup();
    type('Practice please');
    await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.push(
      {
        type: 'skill',
        skill: 'practice',
        payload: { id: 'itm_1', kind: 'mcq', level: 1, prompt: 'Pick one', options: [1, {}, null] },
      },
      done,
    );
    expect(screen.getByText('Practice', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByText('Pick one')).toBeNull();
    expect(screen.queryByLabelText('Your answer')).toBeNull();
  });
});
