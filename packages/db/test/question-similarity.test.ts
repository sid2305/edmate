// Task 5.10: pure, no database. Synthetic question wording only, no real student text.
import { describe, expect, it } from 'vitest';
import {
  bestGroup,
  clusterQuestions,
  type ClusterableQuestion,
  type GroupCandidate,
  questionSimilarity,
} from '../src/repositories/question-similarity.js';

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

  it('breaks an equal-score, equal-createdAt tie by the lower candidate id, either order', () => {
    const same = (id: string): GroupCandidate =>
      base({ id, groupId: id, text: 'Why does the sky look so blue?', createdAt: '2026-10-20T09:00:00Z' });
    expect(bestGroup('Why does the sky look blue at noon?', [same('tq_b'), same('tq_a')])).toBe(
      'tq_a',
    );
    expect(bestGroup('Why does the sky look blue at noon?', [same('tq_a'), same('tq_b')])).toBe(
      'tq_a',
    );
  });

  it('never matches another agent or teacher (caller only passes its own candidates)', () => {
    // bestGroup itself takes no teacher/agent id: `open` only ever calls it with that teacher's
    // and that agent's own open questions, which it is the caller's job to have already filtered.
    expect(bestGroup('Why does the sky look so blue?', [])).toBeNull();
  });
});

// Task 11.2a: the student pre-class feed's own clusterer (sibling of `bestGroup`, no
// pre-existing group id, a whole list at once).
describe('clusterQuestions', () => {
  const q = (id: string, text: string, createdAt: string): ClusterableQuestion => ({
    id,
    text,
    createdAt,
  });

  it('returns [] for an empty list', () => {
    expect(clusterQuestions([])).toEqual([]);
  });

  it('groups a loose cluster of 3 similarly worded questions, even across two classes', () => {
    const items = [
      q('q1', 'Why does the sky look blue at noon?', '2026-10-20T09:00:00Z'),
      q('q2', 'Why does the sky look so blue?', '2026-10-20T10:00:00Z'),
      q('q3', 'Why is the sky so blue at noon today?', '2026-10-20T11:00:00Z'),
    ];
    const clusters = clusterQuestions(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.groupId).toBe('q1');
    expect(new Set(clusters[0]!.ids)).toEqual(new Set(['q1', 'q2', 'q3']));
  });

  it('keeps two unrelated questions in separate, single-member groups', () => {
    const items = [
      q('q1', 'Why does the sky look blue at noon?', '2026-10-20T09:00:00Z'),
      q('q2', 'How do I divide fractions?', '2026-10-20T10:00:00Z'),
    ];
    const clusters = clusterQuestions(items);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.ids)).toEqual([['q1'], ['q2']]);
  });

  it('biggest group first, ties broken by the oldest group, then by group id', () => {
    const items = [
      q('q1', 'What time does the class start?', '2026-10-20T09:00:00Z'),
      q('q2', 'What time does class begin?', '2026-10-20T09:05:00Z'),
      q('q3', 'How do I divide fractions?', '2026-10-20T08:00:00Z'),
      q('q4', 'How do you divide a fraction?', '2026-10-20T08:05:00Z'),
      q('q5', 'What is the capital of France?', '2026-10-20T07:00:00Z'),
    ];
    const clusters = clusterQuestions(items);
    // Two groups of size 2 (q1/q2 and q3/q4, the second created earlier) and one lone group (q5).
    expect(clusters.map((c) => c.groupId)).toEqual(['q3', 'q1', 'q5']);
    expect(clusters.map((c) => c.ids)).toEqual([
      ['q3', 'q4'],
      ['q1', 'q2'],
      ['q5'],
    ]);
  });

  it('breaks a same-size, same-oldest-time tie by the lower group id', () => {
    // Two unrelated single-item clusters, both sized 1, both starting at the exact same instant:
    // the size and oldest-time tie-breaks both land on a tie, so the final tie-break (group id)
    // decides the order.
    const items = [
      q('qz', 'What is the capital of France?', '2026-10-20T09:00:00Z'),
      q('qm', 'What time is it right now?', '2026-10-20T09:00:00Z'),
      q('qa', 'How do I divide fractions?', '2026-10-20T09:00:00Z'),
    ];
    const clusters = clusterQuestions(items);
    expect(clusters.map((c) => c.groupId)).toEqual(['qa', 'qm', 'qz']);
  });

  it('excludes a perfect-Jaccard match that shares only one term (below MIN_SHARED_TERMS)', () => {
    // 'Newton' vs 'Newton' alone is a perfect Jaccard match (score 1) but shares only one term,
    // so the second one must not join the first one's group.
    const items = [
      q('q1', 'Newton', '2026-10-20T09:00:00Z'),
      q('q2', 'Newton', '2026-10-20T10:00:00Z'),
    ];
    const clusters = clusterQuestions(items);
    expect(clusters.map((c) => c.ids)).toEqual([['q1'], ['q2']]);
  });

  it('breaks same-size, same-oldest-time ties in both group id directions', () => {
    // Two separate pairs of singleton clusters, one tied each way, so both branches of the
    // group id tie-break (`a.groupId < b.groupId`) run true and false at least once.
    const items = [
      q('qb', 'What time is it right now?', '2026-10-20T09:00:00Z'),
      q('qa', 'How do I divide fractions?', '2026-10-20T09:00:00Z'),
      q('qd', 'Where is the library located?', '2026-10-20T09:00:00Z'),
      q('qc', 'What is the capital of France?', '2026-10-20T09:00:00Z'),
    ];
    expect(clusterQuestions(items).map((c) => c.groupId)).toEqual(['qa', 'qb', 'qc', 'qd']);
    expect(clusterQuestions([...items].reverse()).map((c) => c.groupId)).toEqual([
      'qa',
      'qb',
      'qc',
      'qd',
    ]);
  });

  it('is order-independent: shuffled input clusters the same way', () => {
    const items = [
      q('q2', 'Why does the sky look so blue?', '2026-10-20T10:00:00Z'),
      q('q1', 'Why does the sky look blue at noon?', '2026-10-20T09:00:00Z'),
      q('q3', 'How do I divide fractions?', '2026-10-20T11:00:00Z'),
    ];
    const clusters = clusterQuestions(items);
    expect(clusters.map((c) => c.groupId)).toEqual(['q1', 'q3']);
    expect(clusters.map((c) => c.ids)).toEqual([['q1', 'q2'], ['q3']]);
  });
});
