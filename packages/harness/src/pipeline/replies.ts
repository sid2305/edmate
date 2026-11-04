// Built-in reply texts the pipeline needs in more than one step (task 4.7 moved this out of
// runner.ts so postGuard can list it among the fixed texts every post guard passes).

/**
 * Sent only when the escalate step and `fallbackReplies.distress` both give no text. Built in (not
 * injected) so a distressed student always gets a caring reply. Country-neutral: no numbers or
 * country names; the locale pack's helplines come through the normal paths.
 */
export const LAST_RESORT_DISTRESS_REPLY =
  "I'm really glad you told me, and I'm sorry it's this hard right now. You matter. " +
  "I'm an AI, so please reach out to someone you trust right now, like a friend, " +
  'family member, teacher or counsellor. If you are in danger or might hurt yourself, ' +
  'contact your local emergency services now.';

/**
 * Sent once, before the model's own stream, on the first unheld turn after a session escalated
 * (task 4.3b, lead review Q0/Q4): a short, built-in English check-in that acknowledges without
 * scolding and says support is still there, never that the earlier message is forgotten or that
 * no one will be told, and never a diagnosis. Built in, not injected, for the same reason as
 * `LAST_RESORT_DISTRESS_REPLY`: no i18n library in the harness, pilot is English-only (no prompt-
 * pack edit, no ADR; Q0).
 */
export const DISTRESS_FOLLOWUP_REPLY =
  "Before we carry on: thank you for telling me earlier. I'm glad you're still here with me, " +
  "and support is still there whenever you want it. Now, let's keep going. ";
