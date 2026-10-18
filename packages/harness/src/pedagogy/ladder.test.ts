import type { PackageConfig } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import type { HelpState } from './helpState.js';
import {
  effectiveCeiling,
  type LadderInput,
  type LadderReason,
  type Move,
  nextRung,
  type Rung,
  RUNG_MOVE,
} from './ladder.js';
import { decidePolicy } from './policy.js';
import { ctxWith, helpWith, turnOf } from './testing.js';

type Pkg = Pick<PackageConfig, 'helpCeiling' | 'finalAnswers'>;
const ALLOWED4: Pkg = { helpCeiling: 4, finalAnswers: 'allowed' };
const AFTER4: Pkg = { helpCeiling: 4, finalAnswers: 'after_attempt' };
const NEVER4: Pkg = { helpCeiling: 4, finalAnswers: 'never' };

function input(o: Partial<LadderInput> = {}): LadderInput {
  return {
    pkg: AFTER4,
    skill: 'coach',
    rung: 0,
    kind: 'message',
    intent: 'on_task',
    attempt: 'none',
    help: helpWith(),
    ...o,
  };
}

describe('effectiveCeiling', () => {
  it.each([
    [1, 'allowed', 'coach', 1],
    [4, 'allowed', 'coach', 4],
    [4, 'after_attempt', 'coach', 4],
    [4, 'never', 'coach', 3],
    [3, 'never', 'coach', 3],
    [2, 'never', 'coach', 2],
    [4, 'allowed', 'practice', 3],
    [2, 'allowed', 'practice', 2],
  ] as const)(
    'helpCeiling %i, finalAnswers %s, skill %s → %i',
    (helpCeiling, finalAnswers, skill, n) => {
      expect(effectiveCeiling({ helpCeiling, finalAnswers }, skill)).toBe(n);
    },
  );

  it('defaults to the coach cap', () => {
    expect(effectiveCeiling(ALLOWED4)).toBe(4);
  });
});

describe('RUNG_MOVE', () => {
  it('maps 0 ask, 1 and 2 hint, 3 worked_example, 4 solution', () => {
    expect(RUNG_MOVE).toEqual({
      0: 'ask',
      1: 'hint',
      2: 'hint',
      3: 'worked_example',
      4: 'solution',
    });
  });
});

interface Row {
  name: string;
  in: Partial<LadderInput>;
  rung: Rung;
  move: Move;
  reason: LadderReason;
  next?: Partial<HelpState> & { helpRung?: Rung };
}

const climbs: Row[] = ([0, 1, 2] as const).flatMap((n) => {
  const to = (n + 1) as Rung;
  const move = RUNG_MOVE[to];
  return [
    {
      name: `hint_request ${n} → ${to}`,
      in: { rung: n, kind: 'hint_request' },
      rung: to,
      move,
      reason: 'climb',
      next: { stuckTurns: 0, helpRung: to },
    },
    {
      name: `answer_seeking ${n} → ${to}`,
      in: { rung: n, intent: 'answer_seeking' },
      rung: to,
      move,
      reason: 'climb',
    },
    {
      name: `second turn with attempt wrong ${n} → ${to}`,
      in: { rung: n, attempt: 'wrong', help: helpWith({ stuckTurns: 1 }) },
      rung: to,
      move,
      reason: 'climb',
      next: { stuckTurns: 0 },
    },
    {
      name: `second turn with attempt none ${n} → ${to}`,
      in: { rung: n, attempt: 'none', help: helpWith({ stuckTurns: 1 }) },
      rung: to,
      move,
      reason: 'climb',
    },
  ] satisfies Row[];
});

const rows: Row[] = [
  {
    name: 'new problem → 0 ask',
    in: {},
    rung: 0,
    move: 'ask',
    reason: 'no_progress_once',
    next: { stuckTurns: 1, helpRung: 0 },
  },
  ...climbs,
  {
    name: 'first no-progress turn (wrong) stays on its rung and counts it',
    in: { rung: 2, attempt: 'wrong' },
    rung: 2,
    move: 'hint',
    reason: 'no_progress_once',
    next: { stuckTurns: 1, attemptLogged: true },
  },
  {
    name: 'first no-progress turn (none) at rung 3 repeats the worked example',
    in: { rung: 3 },
    rung: 3,
    move: 'worked_example',
    reason: 'no_progress_once',
    next: { stuckTurns: 1, attemptLogged: false },
  },
  {
    name: 'partial → same rung, ask, stuck count cleared',
    in: { rung: 2, attempt: 'partial', help: helpWith({ stuckTurns: 1 }) },
    rung: 2,
    move: 'ask',
    reason: 'step',
    next: { stuckTurns: 0, attemptLogged: true, helpRung: 2 },
  },
  {
    name: 'partial beats hint_request',
    in: { rung: 1, attempt: 'partial', kind: 'hint_request' },
    rung: 1,
    move: 'ask',
    reason: 'step',
  },
  {
    name: 'correct → 0 check, state reset',
    in: {
      rung: 3,
      attempt: 'correct',
      help: helpWith({ stuckTurns: 1, attemptLogged: true, answerKey: ['5/6'] }),
    },
    rung: 0,
    move: 'check',
    reason: 'solved',
    next: { stuckTurns: 0, attemptLogged: false, pendingCheck: false, answerKey: [], helpRung: 0 },
  },
  {
    name: '3 → 4 solution when finalAnswers is allowed (no attempt needed)',
    in: { pkg: ALLOWED4, rung: 3, kind: 'hint_request' },
    rung: 4,
    move: 'solution',
    reason: 'climb',
    next: { pendingCheck: true, helpRung: 4 },
  },
  {
    name: '3 → 4 solution, after_attempt, attempt this turn',
    in: { rung: 3, kind: 'hint_request', attempt: 'wrong' },
    rung: 4,
    move: 'solution',
    reason: 'climb',
    next: { pendingCheck: true, attemptLogged: true },
  },
  {
    name: '3 → 4 solution, after_attempt, attempt logged earlier',
    in: { rung: 3, intent: 'answer_seeking', help: helpWith({ attemptLogged: true }) },
    rung: 4,
    move: 'solution',
    reason: 'climb',
  },
  {
    name: '3 → 4 solution, after_attempt, check_answer turn',
    in: { rung: 3, kind: 'check_answer', help: helpWith({ stuckTurns: 1 }) },
    rung: 4,
    move: 'solution',
    reason: 'climb',
    next: { attemptLogged: true },
  },
  {
    name: '3 stays 3 for after_attempt with no attempt: ask for one',
    in: { rung: 3, kind: 'hint_request' },
    rung: 3,
    move: 'ask',
    reason: 'solution_gated',
    next: { pendingCheck: false, attemptLogged: false, helpRung: 3 },
  },
  {
    name: 'stored rung 4 without a pending check is gated too',
    in: { rung: 4 },
    rung: 3,
    move: 'ask',
    reason: 'solution_gated',
    next: { stuckTurns: 1, helpRung: 3 },
  },
  {
    name: 'turn after solution → 0 check',
    in: { rung: 4, help: helpWith({ pendingCheck: true, attemptLogged: true, answerKey: ['x'] }) },
    rung: 0,
    move: 'check',
    reason: 'pending_check',
    next: { pendingCheck: false, attemptLogged: false, answerKey: ['x'], helpRung: 0 },
  },
  {
    name: 'pending check beats a hint request',
    in: { rung: 0, kind: 'hint_request', help: helpWith({ pendingCheck: true }) },
    rung: 0,
    move: 'check',
    reason: 'pending_check',
  },
  {
    name: 'at a ceiling below 4 the rung repeats its move',
    in: { pkg: { helpCeiling: 2, finalAnswers: 'allowed' }, rung: 2, kind: 'hint_request' },
    rung: 2,
    move: 'hint',
    reason: 'at_ceiling',
  },
  {
    name: 'a stored rung above a lowered ceiling is clamped first',
    in: { pkg: { helpCeiling: 1, finalAnswers: 'allowed' }, rung: 4 },
    rung: 1,
    move: 'hint',
    reason: 'no_progress_once',
    next: { helpRung: 1 },
  },
  {
    name: 'practice is capped at 3',
    in: { pkg: ALLOWED4, skill: 'practice', rung: 3, kind: 'hint_request' },
    rung: 3,
    move: 'worked_example',
    reason: 'at_ceiling',
  },
  // helpCeiling 4 with finalAnswers never: effective ceiling 3, never a solution.
  {
    name: 'never: hint_request at 3 with an attempt logged stays 3',
    in: { pkg: NEVER4, rung: 3, kind: 'hint_request', help: helpWith({ attemptLogged: true }) },
    rung: 3,
    move: 'worked_example',
    reason: 'at_ceiling',
  },
  {
    name: 'never: answer_seeking at 3 with an attempt this turn stays 3',
    in: { pkg: NEVER4, rung: 3, intent: 'answer_seeking', attempt: 'wrong' },
    rung: 3,
    move: 'worked_example',
    reason: 'at_ceiling',
  },
  {
    name: 'never: second stuck turn at 3 stays 3',
    in: { pkg: NEVER4, rung: 3, attempt: 'wrong', help: helpWith({ stuckTurns: 1 }) },
    rung: 3,
    move: 'worked_example',
    reason: 'at_ceiling',
  },
  {
    name: 'never: a stored helpRung 4 is clamped to 3',
    in: { pkg: NEVER4, rung: 4, kind: 'check_answer' },
    rung: 3,
    move: 'worked_example',
    reason: 'no_progress_once',
    next: { helpRung: 3 },
  },
];

describe('help ladder transitions', () => {
  it.each(rows)('$name', (row) => {
    const out = nextRung(input(row.in));
    expect({ rung: out.rung, move: out.move, reason: out.reason }).toEqual({
      rung: row.rung,
      move: row.move,
      reason: row.reason,
    });
    const { helpRung, ...help } = row.next ?? {};
    if (helpRung !== undefined) expect(out.next.helpRung).toBe(helpRung);
    expect(out.next.help).toMatchObject(help);
  });

  it('never yields solution and the move is never solution under never', () => {
    for (const r of rows.filter((x) => x.in.pkg === NEVER4)) {
      expect(nextRung(input(r.in)).move).not.toBe('solution');
    }
  });

  it('keeps the answer key while a problem is open and copies it', () => {
    const help = helpWith({ answerKey: ['5/6'] });
    const out = nextRung(input({ rung: 1, kind: 'hint_request', help }));
    expect(out.next.help.answerKey).toEqual(['5/6']);
    expect(out.next.help.answerKey).not.toBe(help.answerKey);
  });

  it('helpCeiling 4 + never through the policy: mustNotReveal holds the answer key', () => {
    const r = decidePolicy({
      ctx: ctxWith({ pkg: NEVER4, helpRung: 4, intent: 'answer_seeking', attempt: 'wrong' }),
      turn: turnOf('hint_request'),
      help: helpWith({ attemptLogged: true, answerKey: ['5/6'] }),
    });
    expect(r.move).toBe('worked_example');
    expect(r.rung).toBe(3);
    expect(r.mustNotReveal).toEqual(['5/6']);
  });
});

describe('exhaustive grid', () => {
  const triggers = [
    'hint_request',
    'answer_seeking',
    'stuck',
    'partial',
    'correct',
    'none',
  ] as const;
  const finals = ['never', 'after_attempt', 'allowed'] as const;
  const ceilings = [1, 2, 3, 4] as const;
  const froms = [0, 1, 2, 3, 4] as const;

  function triggerInput(t: (typeof triggers)[number]): Partial<LadderInput> {
    switch (t) {
      case 'hint_request':
        return { kind: 'hint_request' };
      case 'answer_seeking':
        return { intent: 'answer_seeking' };
      case 'stuck':
        return { attempt: 'wrong' };
      case 'partial':
        return { attempt: 'partial' };
      case 'correct':
        return { attempt: 'correct' };
      case 'none':
        return {};
    }
  }

  let cases = 0;
  for (const helpCeiling of ceilings) {
    for (const finalAnswers of finals) {
      for (const from of froms) {
        for (const t of triggers) {
          for (const logged of [false, true]) {
            for (const stuckTurns of [0, 1] as const) {
              cases++;
              const pkg = { helpCeiling, finalAnswers };
              const i = input({
                pkg,
                rung: from,
                ...triggerInput(t),
                help: helpWith({ attemptLogged: logged, stuckTurns }),
              });
              const out = nextRung(i);
              const ceiling = effectiveCeiling(pkg);
              const clamped = Math.min(from, ceiling);
              const attemptNow = i.attempt !== 'none' || i.kind === 'check_answer' || logged;
              const gateOpen =
                finalAnswers === 'allowed' || (finalAnswers === 'after_attempt' && attemptNow);
              const label = `${helpCeiling}/${finalAnswers}/${from}/${t}/${logged}/${stuckTurns}`;
              it.concurrent(label, () => {
                expect(out.rung).toBeLessThanOrEqual(ceiling);
                expect(out.next.helpRung).toBe(out.rung);
                expect(out.rung).toBeLessThanOrEqual(clamped + 1);
                if (out.move === 'solution') {
                  expect(ceiling).toBe(4);
                  expect(gateOpen).toBe(true);
                  expect(out.rung).toBe(4);
                  expect(out.next.help.pendingCheck).toBe(true);
                }
                if (finalAnswers === 'never') expect(out.move).not.toBe('solution');
                if (t === 'correct') expect([out.rung, out.move]).toEqual([0, 'check']);
                if (t === 'partial') expect(out.move).toBe('ask');
                expect(out.next.help.stuckTurns === 0 || out.next.help.stuckTurns === 1).toBe(true);
              });
            }
          }
        }
      }
    }
  }

  it('covers every combination', () => {
    expect(cases).toBe(4 * 3 * 5 * 6 * 2 * 2);
  });
});
