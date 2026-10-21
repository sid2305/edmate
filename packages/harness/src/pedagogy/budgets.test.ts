import { PedagogyDecisionSchema, SkillSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_TOKENS, maxOutputTokensFor, SKILL_OUTPUT_TOKENS } from './budgets.js';

const MOVES = PedagogyDecisionSchema.shape.move.options;

describe('maxOutputTokens per move', () => {
  it.each(MOVES)('%s has a positive integer budget', (move) => {
    const n = MAX_OUTPUT_TOKENS[move];
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it('has exactly one entry per move (fails when a move is added without a budget)', () => {
    expect(Object.keys(MAX_OUTPUT_TOKENS).sort()).toEqual([...MOVES].sort());
  });

  it('pins the provisional table', () => {
    expect(MAX_OUTPUT_TOKENS).toMatchInlineSnapshot(`
      {
        "ask": 200,
        "ask_teacher": 250,
        "check": 250,
        "explain": 400,
        "hint": 250,
        "locked": 150,
        "redirect": 150,
        "solution": 700,
        "worked_example": 600,
      }
    `);
    expect(SKILL_OUTPUT_TOKENS).toMatchInlineSnapshot(`
      {
        "feedback": 500,
        "mock_interview": 350,
        "revision": 700,
      }
    `);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(MAX_OUTPUT_TOKENS)).toBe(true);
    expect(Object.isFrozen(SKILL_OUTPUT_TOKENS)).toBe(true);
  });

  it.each([
    ['explain', 'revision', 700],
    ['hint', 'feedback', 500],
    ['hint', 'coach', 250],
    // Room for the role-play debrief: two strengths and two improvements, each cited (5.8).
    ['ask', 'mock_interview', 350],
    ['explain', 'explain', 400],
    ['locked', null, 150],
    ['ask_teacher', null, 250],
  ] as const)('%s for skill %s → %i', (move, skill, n) => {
    expect(maxOutputTokensFor(move, skill)).toBe(n);
  });

  it('every move × skill budget is a positive integer', () => {
    for (const move of MOVES) {
      for (const skill of [...SkillSchema.options, null]) {
        const n = maxOutputTokensFor(move, skill);
        expect(Number.isInteger(n) && n > 0).toBe(true);
      }
    }
  });
});
