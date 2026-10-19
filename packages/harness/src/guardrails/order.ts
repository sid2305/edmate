// The declared guard order (task 4.1): the single source of truth for which guards exist in each
// phase and the order they run in. Registration order never decides it, so guard tasks that land
// out of order (4.2-4.9) cannot reorder a chain. Copied from the build plan § Guardrails and safety
// guard table; `piiScrub` (stage "pre" in the table) runs in its own scrub sub-step (step 3a).

export const GUARD_PHASES = Object.freeze(['scrub', 'pre', 'post'] as const);
export type GuardPhase = (typeof GUARD_PHASES)[number];

export const GUARD_ORDER: Readonly<Record<GuardPhase, readonly string[]>> = Object.freeze({
  scrub: Object.freeze(['piiScrub']),
  pre: Object.freeze(['distressDetect', 'moderationIn', 'jailbreak']),
  post: Object.freeze([
    'answerLeak',
    'lockedLeak',
    'grounding',
    'adviceGuard',
    'personaBoundary',
    'tone',
  ]),
});

/** True only for the three own phase names (never an inherited key like `constructor`). */
export function isGuardPhase(x: unknown): x is GuardPhase {
  return typeof x === 'string' && (GUARD_PHASES as readonly string[]).includes(x);
}

/** The guard's position in its phase's declared order, or -1 when it is not declared there. */
export function declaredIndex(phase: GuardPhase, name: string): number {
  if (!isGuardPhase(phase) || typeof name !== 'string') return -1;
  return GUARD_ORDER[phase].indexOf(name);
}
