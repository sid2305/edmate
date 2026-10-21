// The role-play state machine (task 5.8, ADR-0013 §1). Pure: no model, no clock, no ports. It runs
// on a `mock_interview` turn with a persona (`skillStep`) and turns the stored count, persona id and
// stored phase into this turn's phase, the numbers the frame shows, and the state to save. The
// model never keeps the count; it is told the phase.
import type { Persona } from '@edmate/contracts';
import { type HelpState, PERSONA_QUESTIONS_MAX, type StoredPersonaPhase } from './helpState.js';

export type { StoredPersonaPhase } from './helpState.js';

/** A role-play control a turn carries (3.11e): the start button, `/pause` or `stop`. */
export type RolePlayControl = 'start' | 'pause' | 'stop';

/** This turn's role-play phase; never stored (`StoredPersonaPhase` is what lasts). */
export const ROLEPLAY_PHASES = Object.freeze([
  'question',
  'pause',
  'resume',
  'debrief',
  'stopped',
  'ended',
] as const);
export type RolePlayPhase = (typeof ROLEPLAY_PHASES)[number];

/**
 * This turn's role-play, keyed on the phase. Each member carries exactly the server-computed
 * numbers its frame section takes, so no client text and no model count ever reaches it.
 */
export type RolePlay =
  | Readonly<{ phase: 'question' | 'pause' | 'resume'; question: number; total: number }>
  | Readonly<{ phase: 'debrief'; total: number }>
  | Readonly<{ phase: 'stopped'; answered: number }>
  | Readonly<{ phase: 'ended' }>;

/**
 * Whether this role-play turn skips the coverage gate (5.8, open question 6: lead default,
 * pending B-37; ADR-0013 §1). Every turn but an answer to a question skips it: `/pause`, `stop`,
 * resume, debrief and ended turns judge or steer the role-play, not the material, and the opening
 * question (N = 1, a start) with no material asks the student which topic to practise. A gated
 * one would open a teacher question and, on `stop`, never end the role-play. Question N > 1 (the
 * student's answer to N − 1) still goes through the gate like any other turn.
 */
export function rolePlaySkipsCoverageGate(r: RolePlay): boolean {
  return r.phase !== 'question' || r.question === 1;
}

/** The frame section that states a phase (`frame@1.2.0`, ADR-0013 §3). */
export type RolePlayStateSection = `roleplay-${RolePlayPhase}`;
/** The seven role-play frame sections: the move line plus one per phase. */
export type RolePlaySection = 'move-roleplay' | RolePlayStateSection;

/** Each phase's section, so the composer's switch over phases is exhaustive. */
export const ROLEPLAY_PHASE_SECTION: Readonly<Record<RolePlayPhase, RolePlayStateSection>> =
  Object.freeze({
    question: 'roleplay-question',
    pause: 'roleplay-pause',
    resume: 'roleplay-resume',
    debrief: 'roleplay-debrief',
    stopped: 'roleplay-stopped',
    ended: 'roleplay-ended',
  });

export interface RolePlayStepInput {
  persona: Pick<Persona, 'id' | 'endAfterQuestions'>;
  /** The loaded state: the count, the persona it belongs to and the stored phase. */
  help: Readonly<Pick<HelpState, 'personaQuestionsAsked' | 'personaId' | 'personaPhase'>>;
  control?: RolePlayControl;
}

export interface RolePlayStep {
  rolePlay: RolePlay;
  /** The count to save. */
  asked: number;
  /** The phase to save; null removes it. */
  stored: StoredPersonaPhase | null;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/**
 * The table in ADR-0013 §1; the first matching row wins. `M'` is the persona's M, at least 1 and
 * at most PERSONA_QUESTIONS_MAX. The count moves only on a start and on a `question` turn (which
 * is reached only while the count is under M'), so a saved count of M' with no phase means
 * question M' is waiting for its answer. Every number handed on is clamped: a stored count can
 * be 0 (the id is carried without it) or above M' (a lower M went live mid-session).
 */
export function rolePlayStep(i: RolePlayStepInput): RolePlayStep {
  const { persona, help, control } = i;
  const total = Math.min(Math.max(1, persona.endAfterQuestions), PERSONA_QUESTIONS_MAX);
  const before = help.personaQuestionsAsked ?? 0;
  const at = clamp(before, 1, total);

  if (control === 'start' || help.personaId !== persona.id) {
    return { rolePlay: { phase: 'question', question: 1, total }, asked: 1, stored: null };
  }
  if (help.personaPhase === 'ended') {
    return { rolePlay: { phase: 'ended' }, asked: before, stored: 'ended' };
  }
  if (control === 'pause') {
    return { rolePlay: { phase: 'pause', question: at, total }, asked: before, stored: 'paused' };
  }
  if (control === 'stop') {
    const answered = clamp(before - 1, 0, total);
    return { rolePlay: { phase: 'stopped', answered }, asked: before, stored: 'ended' };
  }
  if (help.personaPhase === 'paused') {
    return { rolePlay: { phase: 'resume', question: at, total }, asked: before, stored: null };
  }
  if (before >= total) {
    return { rolePlay: { phase: 'debrief', total }, asked: before, stored: 'ended' };
  }
  const question = before + 1;
  return { rolePlay: { phase: 'question', question, total }, asked: question, stored: null };
}
