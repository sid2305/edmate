// The regulated-subject disclaimer (task 4.8): one lookup shared by the system-prompt composer
// (which tells the model to add the notice word for word) and adviceGuard (which appends it when
// the model did not), so the two can never say different things.
import type { AgentConfig, LocalePack } from '@edmate/contracts';
import { inline } from './dataText.js';

export type RegulatedSubject = NonNullable<AgentConfig['regulatedSubject']>;

/**
 * The market's own disclaimer for `subject`, rendered on one line as the composer renders it, else
 * the frame's generic one (`generic-disclaimer`, used as it is). No subject: the generic one.
 */
export function resolveDisclaimer(
  subject: RegulatedSubject | undefined,
  locale: Pick<LocalePack, 'regulatedDisclaimers'>,
  genericDisclaimer: string,
): string {
  const own = subject === undefined ? undefined : locale.regulatedDisclaimers[subject];
  return own === undefined ? genericDisclaimer : inline(own);
}
