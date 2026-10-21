// The web's fallback replies (task 9.4): English copies of the CLI's (apps/cli chat deps.ts).
// Duplicated for now (handoff decision); a follow-up moves them into @edmate/content.
import type { Lang, LocalePack } from '@edmate/contracts';
import type { FallbackReplies } from '@edmate/harness';

export const SAFE_REPLY = "Sorry, I can't answer that right now. Please try again.";

/** The caring reply when escalation fails: the locale pack's helplines, by name and number. */
export function distressReply(_lang: Lang, locale: LocalePack): string {
  const lines = locale.helplines.map((h) => `${h.name}: ${h.number}`).join('; ');
  return `I'm really glad you told me. You're not alone, and it's worth talking to someone right away: ${lines}`;
}

export function webFallbackReplies(): FallbackReplies {
  return {
    safeReply: () => SAFE_REPLY,
    distress: (lang, locale) => distressReply(lang, locale),
  };
}
