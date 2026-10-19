// Pilot policy (task 3.11c; 18 Oct 2026 decision, docs/decisions/log.md): the pilot teaches and
// replies in English only. `AgentConfigSchema.languages` stays general (it is a frozen contract
// and a contracts change needs an ADR); this package enforces the narrower pilot rule instead,
// wherever an agent config is validated for publishing or seeding.
import type { Lang } from '@edmate/contracts';

/** Named once: the only languages the pilot may pin an agent to. */
export const PILOT_LANGUAGES: readonly Lang[] = ['en'];

/**
 * `languages` must be exactly `PILOT_LANGUAGES`, in order, while the pilot policy is in force.
 * Returns one plain-words issue, or none when it passes (same shape as a `ContentRule`).
 */
export function checkPilotLanguages(languages: readonly Lang[]): string[] {
  const ok =
    languages.length === PILOT_LANGUAGES.length &&
    languages.every((l, i) => l === PILOT_LANGUAGES[i]);
  if (ok) return [];
  return [
    `agent languages must be exactly [${PILOT_LANGUAGES.join(', ')}] during the pilot; got [${languages.join(', ')}]`,
  ];
}
