// Snapshot of the composed prompt per skill and per mode (task 3.6 acceptance), from the fixture
// pack set. 3.11 updates these when the real packs land. A new skill or mode without a case
// fails the coverage test below.
import { SkillSchema, type TurnContext } from '@edmate/contracts';
import { demoAgentConfig, demoChunkScored, demoPersona } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_PROMPT_PACK_VERSION,
  fixturePromptPackSet,
  fixtureRolePlayPromptPackSet,
} from '../testing/promptPackFixtures.js';
import { type ComposeMode, composeSystemPrompt } from './compose.js';
import { decidePolicy, fallbackPolicy, type PolicyResult } from './policy.js';
import { MODE_PACKS } from './promptPacks.js';
import { ctxWith, type CtxOverrides, helpWith, turnOf } from './testing.js';

const agent = { ...demoAgentConfig, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION };
const ALL_SKILLS = SkillSchema.options;
const ctx = (o: CtxOverrides = {}): TurnContext =>
  ctxWith({ agent, entitlement: { skills: [...ALL_SKILLS] }, ...o });

interface Case {
  name: string;
  /** The skill or mode the case covers. */
  covers: string;
  /** The pack the composer must pick. */
  mode: ComposeMode;
  ctx: TurnContext;
  policy: PolicyResult;
}

const key = helpWith({ answerKey: ['5/6'] });

function skillCase(skill: (typeof ALL_SKILLS)[number]): Case {
  const c = ctx(skill === 'mock_interview' ? { persona: demoPersona } : {});
  return {
    name: `skill ${skill}`,
    covers: skill,
    // study_plan (P1) has no pack: the policy sends it to redirect.
    mode: skill === 'study_plan' ? 'redirect' : skill,
    ctx: c,
    policy: decidePolicy({ ctx: c, turn: turnOf('skill_action', skill), help: key }),
  };
}

function rungCase(rung: 0 | 1 | 2 | 3 | 4): Case {
  // A hint request climbs from rung - 1 (rung 0 is a new problem); rung 4 needs an attempt.
  const c = ctx({ helpRung: rung === 0 ? 0 : ((rung - 1) as 0 | 1 | 2 | 3) });
  const help = helpWith({ answerKey: ['5/6'], attemptLogged: true });
  return {
    name: `coach rung ${String(rung)}`,
    covers: 'coach',
    mode: 'coach',
    ctx: c,
    policy: decidePolicy({ ctx: c, turn: turnOf(rung === 0 ? 'message' : 'hint_request'), help }),
  };
}

function modeCase(name: string, mode: ComposeMode, c: TurnContext, p: PolicyResult): Case {
  return { name, covers: mode, mode, ctx: c, policy: p };
}

const notCovered = ctx({ retrieved: [{ ...demoChunkScored, score: 0.1 }] });
const lockedCtx = ctx({ retrieved: [], lockedHit: true });
const offTopic = ctx({ intent: 'off_topic' });
const distress = ctx({ intent: 'distress' });

const CASES: Case[] = [
  ...ALL_SKILLS.map(skillCase),
  ...([0, 1, 2, 3, 4] as const).map(rungCase),
  modeCase(
    'mode locked',
    'locked',
    lockedCtx,
    decidePolicy({ ctx: lockedCtx, turn: turnOf(), help: key }),
  ),
  modeCase(
    'mode ask_teacher',
    'ask_teacher',
    notCovered,
    decidePolicy({ ctx: notCovered, turn: turnOf(), help: key }),
  ),
  modeCase(
    'mode redirect (off_topic)',
    'redirect',
    offTopic,
    decidePolicy({ ctx: offTopic, turn: turnOf(), help: key }),
  ),
  modeCase(
    'mode distress',
    'distress',
    distress,
    decidePolicy({ ctx: distress, turn: turnOf(), help: key }),
  ),
  modeCase('mode fallback', 'fallback', { ...ctx(), retrieved: [] }, fallbackPolicy(ctx(), key)),
];

describe('composed prompt snapshots', () => {
  it('cover every skill and every mode', () => {
    const covered = new Set(CASES.map((c) => c.covers));
    for (const s of ALL_SKILLS) expect(covered, s).toContain(s);
    for (const m of MODE_PACKS) expect(covered, m).toContain(m);
    expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
  });

  it('rung cases reach rungs 0 to 4', () => {
    expect(CASES.filter((c) => c.name.startsWith('coach rung')).map((c) => c.policy.rung)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const r = composeSystemPrompt({
      ctx: c.ctx,
      policy: c.policy,
      lang: 'en',
      set: fixturePromptPackSet,
    });
    expect(r.mode).toBe(c.mode);
    expect({
      move: c.policy.move,
      rung: c.policy.rung,
      mode: r.mode,
      sources: r.sources,
    }).toMatchSnapshot('meta');
    expect(r.systemPrompt).toMatchSnapshot('systemPrompt');
  });
});

// The role-play frame form (5.8, ADR-0013 §3), on the test-only fixture frame: one snapshot per
// phase. The cases above stay on the legacy fixture frame, byte-identical.
describe('composed prompt snapshots, role-play frame', () => {
  const rpAgent = { ...demoAgentConfig, promptPackVersion: fixtureRolePlayPromptPackSet.version };
  const c = ctx({ agent: rpAgent, persona: demoPersona });
  const id = demoPersona.id;
  const M = demoPersona.endAfterQuestions;
  const phases: [string, ReturnType<typeof helpWith>, ('start' | 'pause' | 'stop')?][] = [
    ['question', helpWith(), 'start'],
    ['pause', helpWith({ personaQuestionsAsked: 2, personaId: id }), 'pause'],
    ['resume', helpWith({ personaQuestionsAsked: 2, personaId: id, personaPhase: 'paused' })],
    ['debrief', helpWith({ personaQuestionsAsked: M, personaId: id })],
    ['stopped', helpWith({ personaQuestionsAsked: 3, personaId: id }), 'stop'],
    ['ended', helpWith({ personaQuestionsAsked: M, personaId: id, personaPhase: 'ended' })],
  ];

  it.each(phases)('%s', (phase, help, control) => {
    const policy = decidePolicy({
      ctx: c,
      turn: turnOf(control === 'start' ? 'skill_action' : 'message', 'mock_interview'),
      help,
      ...(control === undefined ? {} : { control }),
    });
    expect(policy.rolePlay?.phase).toBe(phase);
    const r = composeSystemPrompt({
      ctx: c,
      policy,
      lang: 'en',
      set: fixtureRolePlayPromptPackSet,
    });
    expect(r.mode).toBe('mock_interview');
    expect(r.systemPrompt).toMatchSnapshot('systemPrompt');
  });
});
