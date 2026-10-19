// The help ladder (build plan § Teaching engine › Help ladder). Pure: rules only, no model.
import type { PackageConfig, TurnContext, TurnInput } from '@edmate/contracts';
import type { Move } from './budgets.js';
import { copyHelp, type HelpState } from './helpState.js';

export type { Move } from './budgets.js';
export type Rung = TurnContext['helpRung'];
export type LadderSkill = 'coach' | 'practice';
export type LadderPkg = Pick<PackageConfig, 'helpCeiling' | 'finalAnswers'>;

/** Per-skill rung caps: practice answer keys stay server-side, so practice stops at 3. */
export const SKILL_CAP: Readonly<Record<LadderSkill, Rung>> = Object.freeze({
  coach: 4,
  practice: 3,
});

/** 1 nudge, 2 conceptual hint, 3 worked example of a similar problem, 4 solution. */
export const RUNG_MOVE: Readonly<Record<Rung, Move>> = Object.freeze({
  0: 'ask',
  1: 'hint',
  2: 'hint',
  3: 'worked_example',
  4: 'solution',
});

export type LadderReason =
  | 'pending_check'
  | 'solved'
  | 'step'
  | 'climb'
  | 'at_ceiling'
  | 'solution_gated'
  | 'no_progress_once';

export interface LadderInput {
  pkg: LadderPkg;
  skill: LadderSkill;
  /** The stored rung; clamped to the effective ceiling first (the teacher may have lowered it). */
  rung: Rung;
  kind: TurnInput['kind'];
  intent: TurnContext['intent'];
  attempt: TurnContext['attempt'];
  help: Readonly<HelpState>;
}

export interface LadderStep {
  move: Move;
  rung: Rung;
  reason: LadderReason;
  next: { helpRung: Rung; help: HelpState };
}

export function effectiveCeiling(pkg: LadderPkg, skill: LadderSkill = 'coach'): Rung {
  return Math.min(pkg.helpCeiling, pkg.finalAnswers === 'never' ? 3 : 4, SKILL_CAP[skill]) as Rung;
}

/** "An attempt is logged": earlier on this problem, `attempt` not none, or a check_answer turn. */
export function attemptLoggedAfter(
  help: Readonly<HelpState>,
  attempt: TurnContext['attempt'],
  kind: TurnInput['kind'],
): boolean {
  return help.attemptLogged || attempt !== 'none' || kind === 'check_answer';
}

export function nextRung(i: LadderInput): LadderStep {
  const ceiling = effectiveCeiling(i.pkg, i.skill);
  const from = Math.min(i.rung, ceiling) as Rung;
  const attemptLogged = attemptLoggedAfter(i.help, i.attempt, i.kind);
  const { answerKey } = copyHelp(i.help);
  // Sticky for the rest of the session (ADR-0007 §8, 4.6b): the ladder never resets it.
  const lockedStopped = i.help.lockedStopped;

  // After a solution or an explanation, and when the problem is solved: one check.
  if (i.help.pendingCheck) return reset('pending_check');
  if (i.attempt === 'correct') return reset('solved');
  if (i.attempt === 'partial') {
    return step('ask', from, 'step', {
      stuckTurns: 0,
      attemptLogged,
      pendingCheck: false,
      answerKey,
      lockedStopped,
    });
  }
  // attempt is none or wrong from here on.
  const triggered =
    i.kind === 'hint_request' || i.intent === 'answer_seeking' || i.help.stuckTurns === 1;
  if (triggered) {
    const target = Math.min(from + 1, ceiling) as Rung;
    return at(target, target === from ? 'at_ceiling' : 'climb', 0);
  }
  return at(from, 'no_progress_once', 1);

  function at(rung: Rung, reason: LadderReason, stuckTurns: 0 | 1): LadderStep {
    if (rung === 4) {
      const open =
        i.pkg.finalAnswers === 'allowed' ||
        (i.pkg.finalAnswers === 'after_attempt' && attemptLogged);
      if (!open) {
        // Gated at 3: invite an attempt rather than repeat the worked example.
        return step('ask', 3, 'solution_gated', {
          stuckTurns,
          attemptLogged,
          pendingCheck: false,
          answerKey,
          lockedStopped,
        });
      }
      return step('solution', 4, reason, {
        stuckTurns: 0,
        attemptLogged,
        pendingCheck: true,
        answerKey,
        lockedStopped,
      });
    }
    return step(RUNG_MOVE[rung], rung, reason, {
      stuckTurns,
      attemptLogged,
      pendingCheck: false,
      answerKey,
      lockedStopped,
    });
  }

  // Only a solved problem clears the answer key. A pending check can come from an explain
  // turn mid-problem, and clearing the key there would empty mustNotReveal (safety review).
  function reset(reason: 'pending_check' | 'solved'): LadderStep {
    return step('check', 0, reason, {
      stuckTurns: 0,
      attemptLogged: false,
      pendingCheck: false,
      answerKey: reason === 'solved' ? [] : answerKey,
      lockedStopped,
    });
  }
}

function step(move: Move, rung: Rung, reason: LadderReason, help: HelpState): LadderStep {
  return { move, rung, reason, next: { helpRung: rung, help } };
}
