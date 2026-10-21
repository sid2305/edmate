// Task 9.4 Phase B: the client turn reducer, the safety core of the chat. One test per accept rule
// (plan rules 1-8) plus the plan's named cases. Pure: no DOM, no network.
import type { TurnEvent } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { errorText } from './errorText';
import { initialTurn, reduceTurn, type StreamItem, type TurnView } from './turnState';

const ev = (event: TurnEvent): StreamItem => ({ kind: 'event', event });
const tok = (text: string) => ev({ type: 'token', text });
const DONE = ev({ type: 'done', messageId: 'msg-1', usage: [] });
const SRC = { title: 'Algebra notes', locator: 'p. 3', kind: 'material' } as const;
const SKILL = ev({ type: 'skill', skill: 'practice', payload: { q: 1 } });

function run(...items: StreamItem[]): TurnView {
  return items.reduce(reduceTurn, initialTurn());
}

describe('reduceTurn', () => {
  it('starts empty and streaming', () => {
    const t = initialTurn();
    expect(t).toMatchObject({ status: 'streaming', text: '', skills: [], sources: [] });
    expect(t.replaced).toBe(false);
    expect(t.error).toBeNull();
  });

  it('rule 1: tokens append and the text stays provisional (streaming) until done', () => {
    const t = run(tok('Hel'), tok('lo'));
    expect(t.text).toBe('Hello');
    expect(t.status).toBe('streaming');
  });

  it('rule 2: skill events are pushed and stay provisional', () => {
    const t = run(SKILL);
    expect(t.skills).toEqual([{ skill: 'practice', payload: { q: 1 } }]);
    expect(t.status).toBe('streaming');
  });

  it('rule 3: sources, hint_rung, locked, teacher_question and safety set their field', () => {
    const t = run(
      ev({ type: 'sources', items: [SRC] }),
      ev({ type: 'hint_rung', rung: 3 }),
      ev({ type: 'locked', packageName: 'Exam pack' }),
      ev({ type: 'teacher_question', questionId: 'q-1' }),
      ev({ type: 'safety', level: 'alert' }),
    );
    expect(t.sources).toEqual([SRC]);
    expect(t.hintRung).toBe(3);
    expect(t.locked).toEqual({ packageName: 'Exam pack' });
    expect(t.teacherQuestionId).toBe('q-1');
    expect(t.safety).toBe('alert');
  });

  it('rule 3: locked without a package name keeps no name', () => {
    expect(run(ev({ type: 'locked' })).locked).toEqual({});
  });

  it('rule 4: replace with text after shown text sets the text and marks it replaced', () => {
    const t = run(tok('Wrong answer'), ev({ type: 'replace', text: 'Corrected' }));
    expect(t.text).toBe('Corrected');
    expect(t.replaced).toBe(true);
    expect(t.status).toBe('streaming');
  });

  it('rule 4: replace after only a skill card also marks it replaced', () => {
    expect(run(SKILL, ev({ type: 'replace', text: 'x' })).replaced).toBe(true);
  });

  it('rule 4: replace before any token does not set replaced', () => {
    const t = run(ev({ type: 'replace', text: 'Fresh' }));
    expect(t.text).toBe('Fresh');
    expect(t.replaced).toBe(false);
  });

  it("rule 4: replace '' clears text, skills and sources", () => {
    const t = run(tok('Partial'), SKILL, ev({ type: 'sources', items: [SRC] }), ev({ type: 'replace', text: '' }));
    expect(t.text).toBe('');
    expect(t.skills).toEqual([]);
    expect(t.sources).toEqual([]);
    expect(t.replaced).toBe(true);
  });

  it('replace with text keeps the skills and sources', () => {
    const t = run(SKILL, ev({ type: 'sources', items: [SRC] }), ev({ type: 'replace', text: 'y' }));
    expect(t.skills).toHaveLength(1);
    expect(t.sources).toEqual([SRC]);
  });

  it("replace '', then retry tokens, then done gives only the retry text", () => {
    const t = run(tok('Partial'), SKILL, ev({ type: 'replace', text: '' }), tok('Retry '), tok('text'), DONE);
    expect(t.text).toBe('Retry text');
    expect(t.skills).toEqual([]);
    expect(t.status).toBe('final');
  });

  it('rule 5: done makes the turn final and keeps the message id', () => {
    const t = run(tok('Hi'), DONE);
    expect(t.status).toBe('final');
    expect(t.messageId).toBe('msg-1');
    expect(t.text).toBe('Hi');
  });

  it('rule 6: error drops text, skills and sources and shows the fixed English text', () => {
    const t = run(
      tok('Partial'),
      SKILL,
      ev({ type: 'sources', items: [SRC] }),
      ev({ type: 'replace', text: 'z' }),
      ev({ type: 'error', code: 'guard_blocked', retryable: false }),
    );
    expect(t.status).toBe('failed');
    expect(t.text).toBe('');
    expect(t.skills).toEqual([]);
    expect(t.sources).toEqual([]);
    expect(t.replaced).toBe(false);
    expect(t.error).toEqual({ code: 'guard_blocked', retryable: false, text: errorText('guard_blocked') });
  });

  it('rule 6: a mid-stream provider_error is retryable', () => {
    const t = run(tok('Part'), ev({ type: 'error', code: 'provider_error', retryable: true }));
    expect(t.error).toMatchObject({ code: 'provider_error', retryable: true });
    expect(t.text).toBe('');
  });

  it('rule 7: stream end without done drops the turn as a retryable provider_error', () => {
    const t = run(tok('Half a rep'), SKILL, ev({ type: 'sources', items: [SRC] }), { kind: 'ended' });
    expect(t.status).toBe('failed');
    expect(t.text).toBe('');
    expect(t.skills).toEqual([]);
    expect(t.sources).toEqual([]);
    expect(t.error).toEqual({
      code: 'provider_error',
      retryable: true,
      text: errorText('provider_error'),
    });
  });

  it('stream end after done keeps the final turn', () => {
    const t = run(tok('Hi'), DONE, { kind: 'ended' });
    expect(t.status).toBe('final');
    expect(t.text).toBe('Hi');
  });

  it('rule 8: events after done are ignored', () => {
    const final = run(tok('Hi'), DONE);
    for (const item of [
      tok(' more'),
      ev({ type: 'replace', text: '' }),
      ev({ type: 'error', code: 'provider_error', retryable: true }),
      SKILL,
      ev({ type: 'sources', items: [SRC] }),
      ev({ type: 'done', messageId: 'msg-2', usage: [] }),
    ]) {
      expect(reduceTurn(final, item)).toBe(final);
    }
  });

  it('rule 8: events after error are ignored', () => {
    const failed = run(ev({ type: 'error', code: 'rate_limited', retryable: true }));
    for (const item of [tok('late'), DONE, SKILL, { kind: 'ended' } as const]) {
      expect(reduceTurn(failed, item)).toBe(failed);
    }
  });

  it('does not mutate the previous state', () => {
    const a = run(tok('a'), SKILL);
    const snapshot = structuredClone(a);
    reduceTurn(a, tok('b'));
    reduceTurn(a, SKILL);
    reduceTurn(a, ev({ type: 'replace', text: '' }));
    expect(a).toEqual(snapshot);
  });
});
