import type { Skill } from '@edmate/contracts';
import { demoPersona } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { decidePolicy, type PolicyResult } from './policy.js';
import { selectSkill } from './skills.js';
import { ctxWith, helpWith, turnOf } from './testing.js';

const ALL: Skill[] = [
  'explain',
  'coach',
  'practice',
  'feedback',
  'mock_interview',
  'revision',
  'study_plan',
];

describe('selectSkill', () => {
  it.each([
    ['message, coach entitled', turnOf(), ['explain', 'coach'], 'coach'],
    ['message, no coach', turnOf(), ['practice', 'explain'], 'explain'],
    ['message, neither coach nor explain', turnOf(), ['practice', 'feedback'], 'practice'],
    ['message, none entitled', turnOf(), [], null],
    ['skill_action for an entitled skill', turnOf('skill_action', 'practice'), ALL, 'practice'],
    ['skill_action outside the entitlement', turnOf('skill_action', 'feedback'), ['coach'], null],
    ['skill_action without a skill fails closed', turnOf('skill_action'), ALL, null],
    ['hint_request inside practice', turnOf('hint_request', 'practice'), ALL, 'practice'],
    ['hint_request with no skill → default', turnOf('hint_request'), ALL, 'coach'],
  ] as const)('%s', (_n, turn, skills, expected) => {
    expect(selectSkill(turn, { skills: [...skills] })).toBe(expected);
  });
});

function run(
  skill: Skill,
  o: Parameters<typeof ctxWith>[0] = {},
  kind: 'skill_action' | 'hint_request' | 'message' | 'check_answer' = 'skill_action',
  help = helpWith(),
): PolicyResult {
  return decidePolicy({
    ctx: ctxWith({ entitlement: { skills: ALL }, ...o }),
    turn: turnOf(kind, skill),
    help,
  });
}

describe('skill default moves', () => {
  it.each([
    ['explain', 'explain', 'explain', 'explain'],
    ['coach', 'ask', 'coach', 'no_progress_once'],
    ['practice', 'check', 'practice', 'practice_item'],
    ['feedback', 'hint', 'feedback', 'feedback'],
    ['mock_interview (persona)', 'ask', 'mock_interview', 'mock_interview'],
    ['revision', 'explain', 'revision', 'revision'],
    ['study_plan (P1)', 'redirect', null, 'skill_not_built'],
  ] as const)('%s → %s', (name, move, skill, reason) => {
    const s = name.split(' ')[0] as Skill;
    const r = run(s, s === 'mock_interview' ? { persona: demoPersona } : {});
    expect({ move: r.move, skill: r.skill, reason: r.reason }).toEqual({ move, skill, reason });
  });

  it('a message turn uses coach when entitled', () => {
    const r = decidePolicy({ ctx: ctxWith(), turn: turnOf(), help: helpWith() });
    expect(r.skill).toBe('coach');
  });

  it('explain → the next turn is a check, then explain again', () => {
    const first = run('explain', { helpRung: 2 });
    expect(first.move).toBe('explain');
    expect(first.next).toEqual({ helpRung: 2, help: helpWith({ pendingCheck: true }) });
    const second = run('explain', { helpRung: 2 }, 'message', first.next.help);
    expect([second.move, second.reason, second.rung]).toEqual(['check', 'explain_check', 0]);
    expect(second.next).toEqual({ helpRung: 2, help: helpWith() });
  });

  it('a coach turn after explain consumes the pending check through the ladder', () => {
    const r = run('coach', { helpRung: 1 }, 'message', helpWith({ pendingCheck: true }));
    expect([r.move, r.rung, r.reason]).toEqual(['check', 0, 'pending_check']);
  });

  it('practice: a hint_request climbs the ladder, capped at 3', () => {
    const r = run('practice', { helpRung: 2 }, 'hint_request');
    expect([r.move, r.rung, r.skill]).toEqual(['worked_example', 3, 'practice']);
    const capped = run(
      'practice',
      { helpRung: 3, pkg: { finalAnswers: 'allowed' } },
      'hint_request',
    );
    expect([capped.move, capped.rung, capped.reason]).toEqual(['worked_example', 3, 'at_ceiling']);
  });

  it('practice: a stored rung 4 is clamped to the practice cap', () => {
    const r = run('practice', { helpRung: 4 }, 'check_answer');
    expect([r.move, r.rung]).toEqual(['check', 3]);
    expect(r.next.helpRung).toBe(3);
    expect(r.next.help.attemptLogged).toBe(true);
  });

  it('practice: a correct answer resets the rung', () => {
    const r = run('practice', { helpRung: 2, attempt: 'correct' }, 'check_answer');
    expect([r.move, r.rung, r.next.helpRung]).toEqual(['check', 0, 0]);
    expect(r.next.help).toEqual(helpWith());
  });

  it('practice: answer_seeking still gets a check, never the answer', () => {
    const r = run(
      'practice',
      { intent: 'answer_seeking' },
      'skill_action',
      helpWith({ answerKey: ['7'] }),
    );
    expect(r.move).toBe('check');
    expect(r.mustNotReveal).toEqual(['7']);
  });

  it('mock_interview without a persona falls back to coach', () => {
    const r = run('mock_interview');
    expect([r.move, r.skill]).toEqual(['ask', 'coach']);
  });

  it('non-ladder skills report rung 0 and keep the ladder state', () => {
    const help = helpWith({ stuckTurns: 1, answerKey: ['k'] });
    for (const s of ['feedback', 'revision', 'study_plan'] as const) {
      const r = run(s, { helpRung: 3 }, 'skill_action', help);
      expect(r.rung).toBe(0);
      expect(r.next).toEqual({ helpRung: 3, help });
      expect(r.next.help).not.toBe(help);
    }
    const m = run('mock_interview', { helpRung: 3, persona: demoPersona }, 'skill_action', help);
    expect(m.next).toEqual({ helpRung: 3, help });
  });

  it('per-skill budgets apply', () => {
    expect(run('revision').maxOutputTokens).toBe(700);
    expect(run('feedback').maxOutputTokens).toBe(500);
    expect(run('explain').maxOutputTokens).toBe(400);
  });
});
