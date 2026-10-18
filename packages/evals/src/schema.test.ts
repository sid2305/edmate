import { describe, expect, it } from 'vitest';
import { EvalCaseSchema } from './schema.js';

const minimal = {
  id: 'test-explain-001',
  suite: 'test',
  package: 'free',
  reviewed_by: 'pending',
  source: 'synthetic fixture',
  turns: [{ student: 'What is a fraction?', expect: { max_words: 80 } }],
};

function issuePaths(value: unknown): string[] {
  const r = EvalCaseSchema.safeParse(value);
  expect(r.success).toBe(false);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

describe('EvalCaseSchema', () => {
  it('parses a minimal valid case', () => {
    expect(EvalCaseSchema.parse(minimal)).toEqual(minimal);
  });

  it('parses every check type together', () => {
    const all = {
      ...minimal,
      turns: [
        {
          student: 'hi',
          expect: {
            must_contain: ['a'],
            must_not_contain: ['b'],
            matches: ['^h'],
            max_words: 3,
            max_chars: 10,
            must_cite_source: true,
            judge: ['The reply greets the student.'],
          },
        },
      ],
    };
    expect(EvalCaseSchema.parse(all)).toEqual(all);
  });

  it('allows a turn with no expect block (pressure build-up)', () => {
    const c = { ...minimal, turns: [{ student: 'one' }, ...minimal.turns] };
    expect(EvalCaseSchema.parse(c).turns[0]).toEqual({ student: 'one' });
  });

  it.each(['id', 'suite', 'package', 'reviewed_by', 'source', 'turns'] as const)(
    'fails naming the missing field %s',
    (field) => {
      const c: Record<string, unknown> = { ...minimal };
      delete c[field];
      expect(issuePaths(c)).toContain(field);
    },
  );

  it('rejects an id outside lowercase letters, digits and -', () => {
    expect(issuePaths({ ...minimal, id: 'Bad_ID' })).toContain('id');
    expect(issuePaths({ ...minimal, id: '../escape' })).toContain('id');
  });

  it('rejects an empty turns list and an empty student message', () => {
    expect(issuePaths({ ...minimal, turns: [] })).toContain('turns');
    expect(issuePaths({ ...minimal, turns: [{ student: '' }] })).toContain('turns.0.student');
  });

  it('rejects an expect block with no checks', () => {
    expect(issuePaths({ ...minimal, turns: [{ student: 'x', expect: {} }] })).toContain(
      'turns.0.expect',
    );
  });

  it('rejects an unknown top-level key and an unknown expect key', () => {
    expect(EvalCaseSchema.safeParse({ ...minimal, extra: 1 }).success).toBe(false);
    expect(
      EvalCaseSchema.safeParse({
        ...minimal,
        turns: [{ student: 'x', expect: { must_containn: ['typo'] } }],
      }).success,
    ).toBe(false);
  });

  it('rejects a non-positive or fractional limit', () => {
    expect(
      issuePaths({ ...minimal, turns: [{ student: 'x', expect: { max_words: 0 } }] }),
    ).toContain('turns.0.expect.max_words');
    expect(
      issuePaths({ ...minimal, turns: [{ student: 'x', expect: { max_chars: 1.5 } }] }),
    ).toContain('turns.0.expect.max_chars');
  });

  it('rejects a regex that does not compile, at parse time', () => {
    expect(
      issuePaths({ ...minimal, turns: [{ student: 'x', expect: { matches: ['(unclosed'] } }] }),
    ).toContain('turns.0.expect.matches.0');
  });
});
