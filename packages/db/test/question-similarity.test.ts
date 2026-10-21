// Task 5.10: pure, no database. Synthetic question wording only, no real student text.
import { describe, expect, it } from 'vitest';
import { bestGroup, type GroupCandidate, questionSimilarity } from '../src/repositories/question-similarity.js';

// Pairs that should group (similar wording about the same thing) and pairs that should not
// (different topics, or too little text in common).
const SHOULD_GROUP: [string, string][] = [
  ['Why does the sky look blue at noon?', 'Why does the sky look so blue?'],
  ['How do I divide fractions?', 'How do you divide a fraction?'],
  ['What is the capital of France?', 'What is the capital city of France?'],
  ['Why is my code throwing a null pointer error?', 'Why does my code throw a null pointer?'],
  ['How does photosynthesis work in plants?', 'How does photosynthesis work?'],
  ['Can you explain Newton third law of motion?', "Explain Newton's third law of motion please"],
];

const SHOULD_NOT_GROUP: [string, string][] = [
  ['Why does the sky look blue at noon?', 'How do I divide fractions?'],
  ['What is the capital of France?', 'Why is my code throwing a null pointer error?'],
  ['How does photosynthesis work in plants?', 'Can you explain Newton third law of motion?'],
  ['What time is it?', 'Where is the library?'],
  ['Why?', 'How?'],
  ['', 'Why does the sky look blue at noon?'],
];

describe('questionSimilarity', () => {
  it.each(SHOULD_GROUP)('groups %j and %j (>= 0.5, >= 2 shared terms)', (a, b) => {
    expect(questionSimilarity(a, b)).toBeGreaterThanOrEqual(0.5);
  });

  it.each(SHOULD_NOT_GROUP)('does not group %j and %j', (a, b) => {
    expect(questionSimilarity(a, b)).toBeLessThan(0.5);
  });

  it('is symmetric and 0 for two questions with no terms in common', () => {
    expect(questionSimilarity('apple banana', 'apple banana')).toBe(1);
    expect(questionSimilarity('apple banana', 'banana apple')).toBe(1);
    expect(questionSimilarity('apple', 'banana')).toBe(0);
  });

  it('is 0 when either side has no usable terms', () => {
    expect(questionSimilarity('', 'why does the sky look blue')).toBe(0);
    expect(questionSimilarity('the a an', 'why does the sky look blue')).toBe(0);
  });
});

describe('bestGroup', () => {
  const base = (over: Partial<GroupCandidate>): GroupCandidate => ({
    id: 'tq_1',
    text: 'Why does the sky look blue at noon?',
    groupId: 'tq_1',
    createdAt: '2026-10-20T10:00:00Z',
    ...over,
  });

  it('returns null when nothing matches', () => {
    expect(
      bestGroup('How do I divide fractions?', [base({ id: 'tq_1', groupId: 'tq_1' })]),
    ).toBeNull();
  });

  it("returns the single matching candidate's effective group", () => {
    expect(
      bestGroup('Why does the sky look so blue?', [base({ id: 'tq_1', groupId: 'tq_1' })]),
    ).toBe('tq_1');
  });

  it("a candidate with no group_id yet (null) groups onto the candidate's own id", () => {
    expect(
      bestGroup('Why does the sky look so blue?', [
        base({ id: 'tq_1', groupId: null }),
      ]),
    ).toBe('tq_1');
  });

  it('the highest-scoring candidate wins among several matches', () => {
    const candidates: GroupCandidate[] = [
      base({ id: 'tq_1', groupId: 'tq_1', text: 'Why is the sky blue at all, ever?' }),
      base({
        id: 'tq_2',
        groupId: 'tq_2',
        text: 'Why does the sky look so blue at noon today?',
      }),
    ];
    expect(bestGroup('Why does the sky look blue at noon?', candidates)).toBe('tq_2');
  });

  it('ties go to the oldest candidate', () => {
    const candidates: GroupCandidate[] = [
      base({
        id: 'tq_new',
        groupId: 'tq_new',
        text: 'Why does the sky look so blue?',
        createdAt: '2026-10-20T12:00:00Z',
      }),
      base({
        id: 'tq_old',
        groupId: 'tq_old',
        text: 'Why does the sky look so blue?',
        createdAt: '2026-10-20T09:00:00Z',
      }),
    ];
    expect(bestGroup('Why does the sky look blue at noon?', candidates)).toBe('tq_old');
  });

  it('never matches another agent or teacher (caller only passes its own candidates)', () => {
    // bestGroup itself takes no teacher/agent id: `open` only ever calls it with that teacher's
    // and that agent's own open questions, which it is the caller's job to have already filtered.
    expect(bestGroup('Why does the sky look so blue?', [])).toBeNull();
  });
});
