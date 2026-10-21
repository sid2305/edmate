import type { Message, TurnInput } from '@edmate/contracts';
import { demoTurnInput } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { QUERY_PART_MAX_CHARS, retrievalQueries, retrievalQuery } from './retrievalQuery.js';

const msg = (i: number, role: Message['role'], text: string): Message => ({
  id: `msg_${String(i)}`,
  role,
  text,
  createdAt: `2026-10-18T10:00:0${String(i)}Z`,
});

const withText = (text?: string): TurnInput => {
  const rest: TurnInput = { ...demoTurnInput };
  delete rest.text;
  return text === undefined ? rest : { ...rest, text };
};

describe('retrievalQuery: latest message plus the most recent agent question', () => {
  it('a bare answer still retrieves: the active problem comes from the last agent message', () => {
    const history = [
      msg(1, 'agent', 'What is 6 times 7?'),
      msg(2, 'student', 'hmm'),
      msg(3, 'agent', 'What is 1/2 + 1/3?'),
      msg(4, 'student', 'no idea'),
    ];
    expect(retrievalQuery(withText('42'), history)).toBe('42\nWhat is 1/2 + 1/3?');
  });

  it('uses only the input when no agent message exists', () => {
    expect(retrievalQuery(withText('How do I add fractions?'), [msg(1, 'student', 'hi')])).toBe(
      'How do I add fractions?',
    );
  });

  it('uses only the agent question when the input has no text (a hint request)', () => {
    expect(retrievalQuery(withText(), [msg(1, 'agent', 'Simplify 4/8.')])).toBe('Simplify 4/8.');
  });

  it('ignores teacher messages and blank parts', () => {
    const history = [msg(1, 'agent', 'Q1?'), msg(2, 'teacher', 'teacher note')];
    expect(retrievalQuery(withText('   '), history)).toBe('Q1?');
    expect(retrievalQuery(withText(' a '), [msg(1, 'agent', '  ')])).toBe('a');
  });

  it('is empty when there is nothing to search for', () => {
    expect(retrievalQuery(withText(), [])).toBe('');
  });

  it('caps each part: the head of the input, the tail of the agent message (its question)', () => {
    const longIn = `${'i'.repeat(QUERY_PART_MAX_CHARS)}DROPPED`;
    const longAgent = `DROPPED${'a'.repeat(QUERY_PART_MAX_CHARS)}`;
    const q = retrievalQuery(withText(longIn), [msg(1, 'agent', longAgent)]);
    expect(q).toBe(`${'i'.repeat(QUERY_PART_MAX_CHARS)}\n${'a'.repeat(QUERY_PART_MAX_CHARS)}`);
    expect(q).not.toContain('DROPPED');
  });

  it('is deterministic', () => {
    const h = [msg(1, 'agent', 'Q?')];
    expect(retrievalQuery(withText('x'), h)).toBe(retrievalQuery(withText('x'), h));
  });
});

describe('retrievalQueries: the student-only part is never diluted by the agent reply (3.4c)', () => {
  it('student is the head of the input alone; withContext is the combined string', () => {
    const history = [msg(1, 'agent', 'What is 1/2 + 1/3?')];
    const qs = retrievalQueries(withText('I add the numerators'), history);
    expect(qs.student).toBe('I add the numerators');
    expect(qs.withContext).toBe('I add the numerators\nWhat is 1/2 + 1/3?');
  });

  it('student is blank for a hint request; withContext is the agent question alone', () => {
    const qs = retrievalQueries(withText(), [msg(1, 'agent', 'Simplify 4/8.')]);
    expect(qs.student).toBe('');
    expect(qs.withContext).toBe('Simplify 4/8.');
  });

  it('no agent message: student and withContext are identical', () => {
    const qs = retrievalQueries(withText('How do I add fractions?'), [msg(1, 'student', 'hi')]);
    expect(qs.student).toBe('How do I add fractions?');
    expect(qs.withContext).toBe(qs.student);
  });

  it('retrievalQuery stays the thin wrapper returning withContext', () => {
    const history = [msg(1, 'agent', 'Q1?')];
    expect(retrievalQuery(withText('x'), history)).toBe(
      retrievalQueries(withText('x'), history).withContext,
    );
  });
});
