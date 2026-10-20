import type { Chunk } from '@edmate/contracts';
import { demoChunk, demoChunkScored } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { coverageGate, DEFAULT_COVERAGE_THRESHOLD, isCovered } from './coverage.js';
import { decidePolicy } from './policy.js';
import { ctxWith, helpWith, turnOf } from './testing.js';

const scored = (score: number, kind: Chunk['kind'] = 'material'): Chunk => ({
  ...demoChunk,
  kind,
  source: { ...demoChunk.source, kind },
  score,
});
const T = DEFAULT_COVERAGE_THRESHOLD;

describe('coverage', () => {
  it('has the default threshold 0.5, calibrated by 5.3 on the demo Q&A set', () => {
    expect(DEFAULT_COVERAGE_THRESHOLD).toBe(0.5);
  });

  const retrievals: [string, Chunk[], boolean][] = [
    ['empty', [], false],
    ['all below threshold', [scored(0.1), scored(0.49)], false],
    ['one exactly at threshold', [scored(0.2), scored(T)], true],
    ['one above', [scored(0.9)], true],
    ['one with no score', [demoChunk], false],
    ['a teacher_note above', [scored(0.82, 'teacher_note')], true],
  ];

  it.each(retrievals)('isCovered: %s → %s', (_n, chunks, covered) => {
    expect(isCovered(chunks, T)).toBe(covered);
  });

  const table = retrievals.flatMap(([name, chunks, covered]) =>
    [false, true].map(
      (lockedHit) =>
        [
          `${name}, lockedHit ${lockedHit}`,
          chunks,
          lockedHit,
          covered ? null : lockedHit ? 'locked' : 'ask_teacher',
        ] as const,
    ),
  );

  it.each(table)('coverageGate: %s → %s', (_n, retrieved, lockedHit, gate) => {
    const ctx = ctxWith({ retrieved, lockedHit });
    expect(coverageGate(ctx, T)).toBe(gate);
    const r = decidePolicy({ ctx, turn: turnOf(), help: helpWith() });
    if (gate === null) {
      expect(['ask', 'hint', 'worked_example', 'solution', 'check']).toContain(r.move);
      expect(r.skill).toBe('coach');
    } else {
      expect(r.move).toBe(gate);
      expect(r.skill).toBeNull();
      expect(r.tools).toEqual([]);
      expect(r.reason).toBe(gate === 'locked' ? 'locked_module' : 'not_covered');
    }
  });

  it('a NaN threshold covers nothing (fails toward ask_teacher)', () => {
    expect(isCovered([scored(0.9)], Number.NaN)).toBe(false);
  });

  it('the threshold is injectable', () => {
    const ctx = ctxWith({ retrieved: [scored(0.3)] });
    const help = helpWith();
    expect(decidePolicy({ ctx, turn: turnOf(), help }).move).toBe('ask_teacher');
    expect(decidePolicy({ ctx, turn: turnOf(), help }, { coverageThreshold: 0.2 }).move).toBe(
      'ask',
    );
  });

  it('the buildContext fallback context (nothing retrieved, not locked) → ask_teacher', () => {
    const r = decidePolicy({
      ctx: ctxWith({ retrieved: [], lockedHit: false }),
      turn: turnOf(),
      help: helpWith(),
    });
    expect(r.move).toBe('ask_teacher');
  });

  it('an uncovered turn leaves the ladder state unchanged', () => {
    const help = helpWith({ stuckTurns: 1, attemptLogged: true, answerKey: ['5/6'] });
    const r = decidePolicy({
      ctx: ctxWith({ retrieved: [], lockedHit: true, helpRung: 2, attempt: 'correct' }),
      turn: turnOf('hint_request'),
      help,
    });
    expect(r.move).toBe('locked');
    expect(r.next).toEqual({ helpRung: 2, help });
    expect(r.mustNotReveal).toEqual(['5/6']);
  });

  it('a skill_action for a skill outside the entitlement → locked', () => {
    const r = decidePolicy({
      ctx: ctxWith(),
      turn: turnOf('skill_action', 'mock_interview'),
      help: helpWith(),
    });
    expect([r.move, r.reason, r.skill]).toEqual(['locked', 'skill_not_entitled', null]);
  });

  it('an entitlement with no skills → locked', () => {
    const r = decidePolicy({
      ctx: ctxWith({ entitlement: { skills: [] } }),
      turn: turnOf(),
      help: helpWith(),
    });
    expect([r.move, r.reason]).toEqual(['locked', 'skill_not_entitled']);
  });

  it('a scored teacher note in the default fixture covers the turn', () => {
    expect(isCovered([demoChunkScored], T)).toBe(true);
  });
});
