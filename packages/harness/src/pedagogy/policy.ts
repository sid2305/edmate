// The teaching policy (build plan § Turn pipeline spec, step 7 `decide`): picks the move, rung,
// mustNotReveal, tools and maxOutputTokens from rules only. Synchronous and pure: no model, no
// clock, no ports. The 3.6 composer adds the system prompt to make a PedagogyDecision.
//
// Order of rules, first match wins:
//   1 distress → redirect   2 skill outside the entitlement → locked   3 misuse → redirect
//   3b off_topic/meta → redirect, except a role-play control (start, `/pause`, `stop`) in an
//   active role-play (5.8 fix round 1)   4 not covered → locked | ask_teacher, except a role-play turn that skips the gate
//   (5.8, `rolePlaySkipsCoverageGate`)   5 the skill's default move (the ladder for coach and
//   practice hints)   then mustNotReveal, tools and the output budget.
import type { Skill, ToolName, TurnContext, TurnInput } from '@edmate/contracts';
import { maxOutputTokensFor, type Move } from './budgets.js';
import { coverageGate, DEFAULT_COVERAGE_THRESHOLD } from './coverage.js';
import { copyHelp, type HelpState, holdsPracticeKey, INITIAL_HELP_STATE } from './helpState.js';
import { effectiveCeiling, type Rung } from './ladder.js';
import { type RolePlay, rolePlaySkipsCoverageGate, rolePlayStep } from './roleplay.js';
import { type RolePlayControl, selectSkill, type SkillStep, skillStep } from './skills.js';

export interface PolicyTool {
  name: ToolName;
  skill: Skill;
}

export interface PolicyInput {
  /** As the runner assembled it (already schema-checked). */
  ctx: TurnContext;
  /** Never the text: route already classified it. */
  turn: Pick<TurnInput, 'kind' | 'skill'>;
  /** The turn's role-play control (3.11e): decide reads it from the text with `rolePlayControl`. */
  control?: RolePlayControl;
  help: Readonly<HelpState>;
  /** The tool registry's list (5.4/5.5). Default none. */
  tools?: readonly PolicyTool[];
}

export interface PolicyOptions {
  coverageThreshold: number;
}

/** A fixed set for the trace and tests; never free text. */
export type PolicyReason =
  | SkillStep['reason']
  | 'distress'
  | 'skill_not_entitled'
  | 'off_topic'
  | 'misuse'
  | 'meta'
  | 'locked_module'
  | 'not_covered'
  | 'fallback';

export interface PolicyResult {
  move: Move;
  rung: Rung;
  /** For the composer's skill pack; null for locked, ask_teacher, redirect and the fallback. */
  skill: Skill | null;
  /** Every key the guards hold (stream gate, postGuard, tool checks); decide copies it. */
  mustNotReveal: string[];
  /**
   * The keys the composer may render in the do-not-say block (5.6c, ADR-0011 §1): always a subset
   * of `mustNotReveal`, and empty whenever a practice key or a carried key is held. No guard reads it.
   */
  promptKeys: string[];
  tools: ToolName[];
  maxOutputTokens: number;
  /** For commit (3.8) to persist. */
  next: { helpRung: Rung; help: HelpState };
  reason: PolicyReason;
  /**
   * This turn's role-play (5.8, ADR-0013 §1), from `skillStep`; absent on every other turn,
   * closed moves and the fallback. Harness-internal: never in `DecideResultSchema`.
   */
  rolePlay?: RolePlay;
}

const DEFAULT_OPTIONS: PolicyOptions = Object.freeze({
  coverageThreshold: DEFAULT_COVERAGE_THRESHOLD,
});

export function decidePolicy(i: PolicyInput, opts: PolicyOptions = DEFAULT_OPTIONS): PolicyResult {
  const { ctx, turn, help } = i;
  // Closed moves teach nothing and leave the ladder where it was.
  const closed = (move: Move, reason: PolicyReason): PolicyResult =>
    finish(i, {
      move,
      rung: 0,
      skill: null,
      reason,
      next: { helpRung: ctx.helpRung, help: copyHelp(help) },
    });

  // Defence in depth: the runner escalates distress before decide. Never a throw, which
  // would fall back to `ask`, a teaching question.
  if (ctx.intent === 'distress') return closed('redirect', 'distress');
  const skill = selectSkill(turn, ctx.entitlement);
  if (skill === null) return closed('locked', 'skill_not_entitled');
  // Misuse stays ahead of a role-play control: `/pause` may be followed by any text, so a
  // control word must never carry a misuse turn past its redirect.
  if (ctx.intent === 'misuse') return closed('redirect', 'misuse');
  const persona = ctx.persona;
  // A control (start, `/pause`, `stop`) in an active role-play beats the meta and off_topic
  // redirect (5.8 fix round 1): a bare "stop" the router labels meta must still stop it.
  const steersRolePlay =
    i.control !== undefined &&
    skill === 'mock_interview' &&
    persona !== undefined &&
    help.personaId === persona.id &&
    help.personaPhase !== 'ended';
  if ((ctx.intent === 'off_topic' || ctx.intent === 'meta') && !steersRolePlay) {
    return closed('redirect', ctx.intent);
  }
  const control = i.control === undefined ? {} : { control: i.control };
  // The role-play phase is worked out before the gate (pure, no state saved yet), so a control,
  // resume, debrief, ended or opening turn skips it (5.8, open question 6: lead default, pending
  // B-37). A closed turn below still leaves the role-play state as it was.
  const rp =
    skill === 'mock_interview' && persona !== undefined
      ? rolePlayStep({ persona, help, ...control })
      : undefined;
  if (rp === undefined || !rolePlaySkipsCoverageGate(rp.rolePlay)) {
    const gate = coverageGate(ctx, opts.coverageThreshold);
    if (gate !== null) return closed(gate, gate === 'locked' ? 'locked_module' : 'not_covered');
  }
  return finish(
    i,
    skillStep({
      ctx,
      turn,
      help,
      skill,
      ...control,
      ...(rp === undefined ? {} : { rolePlayStep: rp }),
    }),
    { allowPracticeRelease: true },
  );
}

/** The `ask` fallback (`redirect` for distress): rung clamped to the package ceiling, no tools, state unchanged. */
export function fallbackPolicy(
  ctx: TurnContext,
  help: Readonly<HelpState> = INITIAL_HELP_STATE,
): PolicyResult {
  // Distress never gets a teaching question, even on the fallback path.
  if (ctx.intent === 'distress') {
    return {
      move: 'redirect',
      rung: 0,
      skill: null,
      ...keysFor(help, false),
      tools: [],
      maxOutputTokens: maxOutputTokensFor('redirect', null),
      next: { helpRung: ctx.helpRung, help: copyHelp(help) },
      reason: 'distress',
    };
  }
  return {
    move: 'ask',
    rung: Math.min(ctx.helpRung, effectiveCeiling(ctx.pkg)) as Rung,
    skill: null,
    ...keysFor(help, false),
    tools: [],
    maxOutputTokens: maxOutputTokensFor('ask', null),
    next: { helpRung: ctx.helpRung, help: copyHelp(help) },
    reason: 'fallback',
  };
}

function finish(
  i: PolicyInput,
  s: Omit<SkillStep, 'reason'> & { reason: PolicyReason },
  opts: { allowPracticeRelease?: boolean } = {},
): PolicyResult {
  const entitled = i.ctx.entitlement.skills;
  const names =
    s.skill === null || !entitled.includes(s.skill)
      ? []
      : (i.tools ?? []).filter((t) => t.skill === s.skill).map((t) => t.name);
  // A practice key is released once the attempt grades correct (5.6f), but only on the main
  // skillStep path: every `closed()` redirect (distress/misuse/off_topic/meta/locked/not_covered/
  // skill_not_entitled) passes no flag, so it keeps the key guarded even if `ctx.attempt`
  // happens to read `correct`.
  const practiceSolved =
    (opts.allowPracticeRelease ?? false) &&
    i.ctx.attempt === 'correct' &&
    holdsPracticeKey(i.help);
  return {
    move: s.move,
    rung: s.rung,
    skill: s.skill,
    // A solution is the one move allowed to state the answer (never reached with finalAnswers
    // never). A practice item's key is released once the attempt grades correct (5.6f); otherwise
    // never, whatever the move (5.6, ADR-0010 §5).
    ...keysFor(
      i.help,
      (s.move === 'solution' &&
        i.ctx.pkg.finalAnswers !== 'never' &&
        !holdsPracticeKey(i.help)) ||
        practiceSolved,
    ),
    tools: [...new Set(names)],
    maxOutputTokens: maxOutputTokensFor(s.move, s.skill),
    next: s.next,
    reason: s.reason,
    ...(s.rolePlay === undefined ? {} : { rolePlay: s.rolePlay }),
  };
}

/**
 * The guarded keys and the prompt's keys (5.6c, ADR-0011), one rule for `finish` and both
 * `fallbackPolicy` branches. `release` drops `answerKey` (a solution move, or a practice key once
 * the attempt grades correct (5.6f)); a carried key is never released. `promptKeys` is empty
 * while a practice key or a carried key is held, so neither ever reaches the model's prompt;
 * otherwise it is `mustNotReveal` (no carried key to remove).
 */
function keysFor(
  help: Readonly<HelpState>,
  release: boolean,
): Pick<PolicyResult, 'mustNotReveal' | 'promptKeys'> {
  const answer = release ? [] : [...help.answerKey];
  const carried = (help.practiceCarriedKey ?? []).filter((k) => !answer.includes(k));
  const mustNotReveal = [...answer, ...carried];
  const hidden = holdsPracticeKey(help) || (help.practiceCarriedKey ?? []).length > 0;
  return { mustNotReveal, promptKeys: hidden ? [] : [...mustNotReveal] };
}
