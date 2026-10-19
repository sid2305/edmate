import type { TurnEvent } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { formatSseEvent } from './sse.js';

describe('formatSseEvent', () => {
  it('writes the type as the event name and the event as one JSON data line', () => {
    expect(formatSseEvent({ type: 'token', text: 'Hi' })).toBe(
      'event: token\ndata: {"type":"token","text":"Hi"}\n\n',
    );
  });

  it('keeps newlines inside the text on one data line', () => {
    const out = formatSseEvent({ type: 'token', text: 'a\nb\r\nc\rd' });
    expect(out.split('\n')).toHaveLength(4);
    expect(JSON.parse(out.split('\n')[1]?.slice('data: '.length) ?? '')).toEqual({
      type: 'token',
      text: 'a\nb\r\nc\rd',
    });
  });

  it('round-trips every event type', () => {
    const events: TurnEvent[] = [
      { type: 'hint_rung', rung: 2 },
      { type: 'sources', items: [{ title: 'Doc', locator: 'p. 1', kind: 'material' }] },
      { type: 'locked' },
      { type: 'teacher_question', questionId: 'tq_1' },
      { type: 'skill', skill: 'practice', payload: { q: 1 } },
      { type: 'replace', text: '' },
      { type: 'done', messageId: 'm_1', usage: [] },
      { type: 'error', code: 'turn_cost_exceeded', retryable: false },
    ];
    for (const e of events) {
      const [name, data] = formatSseEvent(e).split('\n');
      expect(name).toBe(`event: ${e.type}`);
      expect(JSON.parse(data?.slice(6) ?? '')).toEqual(e);
    }
  });

  it('refuses an event that fails the schema (fail closed)', () => {
    expect(() => formatSseEvent({ type: 'token', text: 5 } as unknown as TurnEvent)).toThrow();
    expect(() =>
      formatSseEvent({ type: 'token', text: 'x', extra: 'y' } as unknown as TurnEvent),
    ).toThrow();
  });
});
