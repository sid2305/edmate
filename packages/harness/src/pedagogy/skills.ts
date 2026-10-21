// Skill rules (build plan § Teaching engine › Skills): which skill a turn uses, and its default move.
import type { Entitlement, Skill, TurnContext, TurnInput } from '@edmate/contracts';
import type { Move } from './budgets.js';
import {
  copyHelp,
  type HelpState,
  INITIAL_HELP_STATE,
  PERSONA_QUESTIONS_MAX,
  personaQuestionsAsked,
  withPersonaCount,
} from './helpState.js';
import {
  attemptLoggedAfter,
  effectiveCeiling,
  type LadderReason,
  nextRung,
  type Rung,
} from './ladder.js';

export type SkillReason =
  | 'explain'
  | 'explain_check'
  | 'practice_item'
  | 'feedback'
  | 'mock_interview'
  | 'revision'
  | 'skill_not_built'
  | 'no_persona';

export interface SkillStep {
  move: Move;
  rung: Rung;
  /** The skill whose pack the composer uses; null when no skill pack applies. */
  skill: Skill | null;
  reason: SkillReason | LadderReason;
  next: { helpRung: Rung; help: HelpState };
}

/**
 * The turn's skill, or null when it is outside the entitlement (→ `locked`). A turn that names a
 * skill uses it (a practice hint request stays in practice); otherwise coach, then explain, then
 * the first entitled skill. A `skill_action` without a skill fails closed.
 */
export function selectSkill(
  turn: Pick<TurnInput, 'kind' | 'skill'>,
  entitlement: Pick<Entitlement, 'skills'>,
): Skill | null {
  const entitled = entitlement.skills;
  if (turn.skill !== undefined) return entitled.includes(turn.skill) ? turn.skill : null;
  if (turn.kind === 'skill_action') return null;
  if (entitled.includes('coach')) return 'coach';
  if (entitled.includes('explain')) return 'explain';
  return entitled[0] ?? null;
}

/** A role-play control a turn carries (3.11e): the start button, `/pause` or `stop`. */
export type RolePlayControl = 'start' | 'pause' | 'stop';

/**
 * The turn's role-play control (3.11e). Read by decide, so the policy itself never sees the
 * text. `start`: any `skill_action` turn (the client's start button; ordinary answers are
 * `message` turns). `pause`: the text starts with `/pause`. `stop`: the whole text is `stop` or
 * `/stop`, give or take case, spaces and a trailing `.` or `!`.
 */
export function rolePlayControl(
  input: Pick<TurnInput, 'kind' | 'text'>,
): RolePlayControl | undefined {
  if (input.kind === 'skill_action') return 'start';
  const text = (input.text ?? '').trim().toLowerCase();
  if (text.startsWith('/pause')) return 'pause';
  const bare = text.replace(/[.!\s]+$/u, '');
  return bare === 'stop' || bare === '/stop' ? 'stop' : undefined;
}

export interface SkillInput {
  ctx: TurnContext;
  turn: Pick<TurnInput, 'kind' | 'skill'>;
  help: Readonly<HelpState>;
  skill: Skill;
  /** The turn's role-play control (`rolePlayControl`), if any. */
  control?: RolePlayControl;
}

/**
 * The skill's move and next state. The persona question count (3.11d, ADR-0009) is the server's.
 * On a `mock_interview` turn with a persona (3.11e): a start (`control` 'start', or a persona
 * other than the stored `personaId`) opens at question 1; `pause` and `stop` leave it as it was;
 * any other turn counts one more, capped at the persona's M (at least 1) and at
 * PERSONA_QUESTIONS_MAX. Every other path carries the earlier count and id over, including the
 * ladder and a solved practice item, which rebuild the help state from scratch.
 */
export function skillStep(i: SkillInput): SkillStep {
  const s = stepFor(i);
  const persona = i.ctx.persona;
  if (s.reason !== 'mock_interview' || persona === undefined) {
    return { ...s, next: withPersonaCount(s.next, i.help) };
  }
  const before = personaQuestionsAsked(i.help);
  const cap = Math.min(Math.max(1, persona.endAfterQuestions), PERSONA_QUESTIONS_MAX);
  const asked =
    i.control === 'start' || i.help.personaId !== persona.id
      ? 1
      : i.control === 'pause' || i.control === 'stop'
        ? before
        : Math.min(before + 1, cap);
  return {
    ...s,
    next: {
      ...s.next,
      help: { ...s.next.help, personaQuestionsAsked: asked, personaId: persona.id },
    },
  };
}

function stepFor(i: SkillInput): SkillStep {
  const { ctx, help } = i;
  const unchanged = { helpRung: ctx.helpRung, help: copyHelp(help) };
  const fixed = (move: Move, skill: Skill | null, reason: SkillReason): SkillStep => ({
    move,
    rung: 0,
    skill,
    reason,
    next: unchanged,
  });
  const ladder = (skill: 'coach' | 'practice'): SkillStep => ({
    ...nextRung({
      pkg: ctx.pkg,
      skill,
      rung: ctx.helpRung,
      kind: i.turn.kind,
      intent: ctx.intent,
      attempt: ctx.attempt,
      help,
    }),
    skill,
  });

  switch (i.skill) {
    case 'explain':
      // Explain, then one comprehension check on the next turn.
      return help.pendingCheck
        ? {
            ...fixed('check', 'explain', 'explain_check'),
            next: { helpRung: ctx.helpRung, help: { ...copyHelp(help), pendingCheck: false } },
          }
        : {
            ...fixed('explain', 'explain', 'explain'),
            next: { helpRung: ctx.helpRung, help: { ...copyHelp(help), pendingCheck: true } },
          };
    case 'coach':
      return ladder('coach');
    case 'practice':
      return i.turn.kind === 'hint_request' ? ladder('practice') : practiceCheck(i);
    case 'feedback':
      // Point to the rubric line and the fix; never rewrite the work.
      return fixed('hint', 'feedback', 'feedback');
    case 'mock_interview':
      // 5.8 owns /pause, the end conditions and the debrief; skillStep counts the question
      // (3.11d). No persona: coach instead, but
      // only when the package includes coach (coach can reach a solution); otherwise locked.
      if (ctx.persona !== undefined) return fixed('ask', 'mock_interview', 'mock_interview');
      return ctx.entitlement.skills.includes('coach')
        ? ladder('coach')
        : fixed('locked', null, 'no_persona');
    case 'revision':
      return fixed('explain', 'revision', 'revision');
    case 'study_plan':
      // P1: not built yet.
      return fixed('redirect', null, 'skill_not_built');
  }
}

/** A practice item turn: always `check`; a correct answer starts a fresh problem. */
function practiceCheck(i: SkillInput): SkillStep {
  const { ctx, help } = i;
  if (ctx.attempt === 'correct') {
    return {
      move: 'check',
      rung: 0,
      skill: 'practice',
      reason: 'practice_item',
      next: { helpRung: 0, help: copyHelp(INITIAL_HELP_STATE) },
    };
  }
  const rung = Math.min(ctx.helpRung, effectiveCeiling(ctx.pkg, 'practice')) as Rung;
  const attemptLogged = attemptLoggedAfter(help, ctx.attempt, i.turn.kind);
  return {
    move: 'check',
    rung,
    skill: 'practice',
    reason: 'practice_item',
    next: { helpRung: rung, help: { ...copyHelp(help), stuckTurns: 0, attemptLogged } },
  };
}
