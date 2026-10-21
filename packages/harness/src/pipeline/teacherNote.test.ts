// Task 5.10: the teacher note's text and citation, shared by the db adapter and the memory double.
import { LIMITS, SourceRefSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { HarnessError } from './errors.js';
import {
  TEACHER_NOTE_PART_MAX,
  TEACHER_NOTE_TITLES,
  teacherNoteParts,
  teacherNoteSource,
  teacherNoteText,
} from './teacherNote.js';

const Q = 'Why does the sky look blue at noon?';
const A = 'Air scatters short blue wavelengths more than long red ones.';

describe('teacherNoteText', () => {
  it('is "Question: <q>\\nAnswer: <a>", exactly', () => {
    expect(teacherNoteText({ question: Q, answer: A })).toBe(`Question: ${Q}\nAnswer: ${A}`);
  });

  it('trims both parts', () => {
    expect(teacherNoteText({ question: `  ${Q}\n`, answer: `\t${A}  ` })).toBe(
      `Question: ${Q}\nAnswer: ${A}`,
    );
  });

  it.each([
    ['empty question', { question: '', answer: A }],
    ['blank question', { question: ' \n\t ', answer: A }],
    ['empty answer', { question: Q, answer: '' }],
    ['blank answer', { question: Q, answer: '   ' }],
    ['too long question', { question: 'q'.repeat(TEACHER_NOTE_PART_MAX + 1), answer: A }],
    ['too long answer', { question: Q, answer: 'a'.repeat(TEACHER_NOTE_PART_MAX + 1) }],
  ])('rejects %s with a fixed message', (_, input) => {
    let caught: unknown;
    try {
      teacherNoteText(input);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    const message = (caught as Error).message;
    expect(message).not.toContain(input.question.slice(0, 10) || '\u0000');
    expect(message).not.toContain(input.answer.slice(0, 10) || '\u0000');
  });

  it('accepts parts at the cap (counted in characters, not UTF-16 units)', () => {
    const q = '🙂'.repeat(TEACHER_NOTE_PART_MAX);
    expect(teacherNoteText({ question: q, answer: A })).toBe(`Question: ${q}\nAnswer: ${A}`);
  });

  it('caps each part at the turn text limit', () => {
    expect(TEACHER_NOTE_PART_MAX).toBe(LIMITS.turnTextMaxLength);
  });
});

describe('teacherNoteParts', () => {
  it('returns the trimmed parts, or null when either is unusable', () => {
    expect(teacherNoteParts({ question: ` ${Q} `, answer: ` ${A} ` })).toEqual({
      question: Q,
      answer: A,
    });
    expect(teacherNoteParts({ question: ' ', answer: A })).toBeNull();
    expect(teacherNoteParts({ question: Q, answer: 'a'.repeat(TEACHER_NOTE_PART_MAX + 1) })).toBe(
      null,
    );
  });
});

describe('teacherNoteSource', () => {
  it('cites a teacher answer as "Teacher\'s answer" and the answer\'s date', () => {
    expect(teacherNoteSource('teacher_answer', '2026-10-21T09:30:00.000Z')).toEqual({
      title: "Teacher's answer",
      locator: '2026-10-21',
      kind: 'teacher_note',
    });
  });

  it('cites a correction as "Teacher\'s correction"', () => {
    expect(teacherNoteSource('correction', '2026-01-02')).toEqual({
      title: "Teacher's correction",
      locator: '2026-01-02',
      kind: 'teacher_note',
    });
  });

  it('takes the UTC date of an epoch-millisecond time', () => {
    expect(teacherNoteSource('teacher_answer', Date.UTC(2026, 9, 21, 23, 59)).locator).toBe(
      '2026-10-21',
    );
  });

  it('is a valid SourceRef with only fixed text and a date: no student text', () => {
    for (const origin of ['teacher_answer', 'correction'] as const) {
      const s = teacherNoteSource(origin, '2026-10-21T00:00:00Z');
      expect(SourceRefSchema.parse(s)).toEqual(s);
      expect(Object.values(TEACHER_NOTE_TITLES)).toContain(s.title);
      expect(s.locator).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(JSON.stringify(s)).not.toContain('sky');
    }
  });

  it.each([
    '',
    'yesterday',
    '21/10/2026',
    '2026-13-01',
    '2026-02-30',
    '2026-02-30T10:00:00Z',
    Number.NaN,
  ])('rejects an unusable date %j', (d) => {
    expect(() => teacherNoteSource('teacher_answer', d)).toThrow(HarnessError);
  });

  it('rejects an unknown origin', () => {
    expect(() => teacherNoteSource('other' as 'correction', '2026-10-21')).toThrow(HarnessError);
  });
});
