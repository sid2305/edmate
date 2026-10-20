// Step 5, escalate (task 4.3): the caring reply. No model call ("skip to step 11"). The reply is
// always the built-in template plus the locale pack's helplines; it never uses the alert (no ids,
// no word about alerts or the trust team). The runner raises the alert from preGuard, or builds
// one, whatever this step returns (4.1 safety review: save the escalate text, always reply with
// the caring template).
//
// English only for the pilot (human decision, 18 Oct 2026); the harness has no i18n library.
import type { LocalePack } from '@edmate/contracts';
import { LAST_RESORT_DISTRESS_REPLY } from '../replies.js';
import type { Steps } from '../types.js';

/**
 * The template (says it is an AI, points to someone the student trusts and local emergency
 * services, promises nothing) plus each helpline in the pack. With no helpline, the template's
 * generic wording stands alone (locale-context rule 4).
 */
export function buildCaringReply(locale: LocalePack): string {
  const lines = locale.helplines
    .filter((h) => h.name.trim() !== '' && h.number.trim() !== '')
    .map((h) => `${h.name.trim()} on ${h.number.trim()}`);
  if (lines.length === 0) return LAST_RESORT_DISTRESS_REPLY;
  return `${LAST_RESORT_DISTRESS_REPLY} You can also call ${lines.join(' or ')}.`;
}

export const escalate: Steps['escalate'] = (_env, s) =>
  Promise.resolve({ replyText: buildCaringReply(s.locale) });
