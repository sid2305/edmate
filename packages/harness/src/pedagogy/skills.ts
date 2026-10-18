// Skill rules (build plan § Teaching engine › Skills): which skill a turn uses, and its default move.
import type { Entitlement, Skill, TurnContext, TurnInput } from '@edmate/contracts';
import type { Move } from './budgets.js';
import { copyHelp, type HelpState, INITIAL_HELP_STATE } from './helpState.js';
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

export interface SkillInput {
  ctx: TurnContext;
  turn: Pick<TurnInput, 'kind' | 'skill'>;
  help: Readonly<HelpState>;
  skill: Skill;
}

export function skillStep(i: SkillInput): SkillStep {
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
      // 5.8 owns /pause, the end conditions and the debrief. No persona: coach instead, but
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
