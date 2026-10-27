// Skill rules (build plan § Teaching engine › Skills): which skill a turn uses, and its default move.
import type { Entitlement, Skill, TurnContext, TurnInput } from '@edmate/contracts';
import type { Move } from './budgets.js';
import { copyHelp, type HelpState, INITIAL_HELP_STATE, withPersonaCount } from './helpState.js';
import {
  attemptLoggedAfter,
  effectiveCeiling,
  type LadderReason,
  nextRung,
  type Rung,
} from './ladder.js';
import {
  type RolePlay,
  type RolePlayControl,
  type RolePlayStep,
  rolePlayStep,
} from './roleplay.js';

export type { RolePlayControl } from './roleplay.js';

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
  /**
   * This turn's role-play (5.8, ADR-0013 §1): set only on a `mock_interview` turn with a persona.
   * Optional because the ladder and every other skill build a step without it.
   */
  rolePlay?: RolePlay;
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

/**
 * Whether a `/pause` carried text after the command (5.8b, B-37 q8). `false` on anything but a
 * `/pause` turn, including a bare one. Decide's caller (`decide.ts`) reads this alongside
 * `rolePlayControl`, so the policy itself never sees the text.
 */
export function pauseHasExtraText(input: Pick<TurnInput, 'kind' | 'text'>): boolean {
  if (input.kind === 'skill_action') return false;
  const text = (input.text ?? '').trim().toLowerCase();
  if (!text.startsWith('/pause')) return false;
  const bare = text.replace(/[.!\s]+$/u, '');
  return bare.slice('/pause'.length).trim().length > 0;
}

export interface SkillInput {
  ctx: TurnContext;
  turn: Pick<TurnInput, 'kind' | 'skill'>;
  help: Readonly<HelpState>;
  skill: Skill;
  /** The turn's role-play control (`rolePlayControl`), if any. */
  control?: RolePlayControl;
  /**
   * `rolePlayStep`'s result when the caller already ran it (decidePolicy runs it before the
   * coverage gate, 5.8). It must come from the same persona, help and control; absent, it is
   * computed here.
   */
  rolePlayStep?: RolePlayStep;
  /**
   * The persona id `rolePlayStep` above was computed for (5.8b, defence in depth, like
   * `compose.ts`'s role-play bug check). Required alongside `rolePlayStep`; `skillStep` throws on
   * a mismatch with `ctx.persona.id` rather than silently teaching the wrong persona.
   */
  rolePlayStepPersonaId?: string;
}

/**
 * The skill's move and next state. The persona question count (3.11d, ADR-0009) and the role-play
 * phase (5.8, ADR-0013) are the server's: on a `mock_interview` turn with a persona,
 * `rolePlayStep` gives this turn's `rolePlay` and the count and phase to save (a start or a
 * persona switch opens question 1; `/pause` holds the question and the next turn resumes it; the
 * answer to question M, or `stop`, gives the debrief and ends the role-play). Every other path
 * carries the earlier count, id and phase over, including the ladder and a solved practice item,
 * which rebuild the help state from scratch.
 */
export function skillStep(i: SkillInput): SkillStep {
  const s = stepFor(i);
  const persona = i.ctx.persona;
  if (s.reason !== 'mock_interview' || persona === undefined) {
    return { ...s, next: withPersonaCount(s.next, i.help) };
  }
  // A bug, never a content error (5.8b, defence in depth, like compose.ts's role-play check): a
  // passed-in rolePlayStep must have been computed for this persona, or the student would be
  // taught with another persona's state.
  if (i.rolePlayStep !== undefined && i.rolePlayStepPersonaId !== persona.id) {
    throw new Error('skillStep: rolePlayStep was computed for a different persona');
  }
  const r =
    i.rolePlayStep ??
    rolePlayStep({
      persona,
      help: i.help,
      ...(i.control === undefined ? {} : { control: i.control }),
    });
  const help: HelpState = {
    ...s.next.help,
    personaQuestionsAsked: r.asked,
    personaId: persona.id,
  };
  if (r.stored === null) delete help.personaPhase;
  else help.personaPhase = r.stored;
  return { ...s, next: { ...s.next, help }, rolePlay: r.rolePlay };
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
      // The role-play phase (/pause, the end conditions, the debrief) and the count come from
      // rolePlayStep in skillStep (5.8, 3.11d); the move stays `ask` in every phase, so the
      // debrief never releases a key (ADR-0013 §4). No persona: coach instead, but
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
