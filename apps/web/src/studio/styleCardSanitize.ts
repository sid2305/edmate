// Task 8.4c (Phase C): strips role-play and rule-override phrases from style-card text before it
// is drafted from or saved, so a style card can never carry a jailbreak phrase into a future turn
// prompt. Deliberately not a reuse of packages/harness/src/guardrails/jailbreakPatterns.ts's RULES
// table: those match on normaliseForDistress's normalised forms (apostrophes dropped, leetspeak
// folded) with no span mapped back to raw text to strip, and cover categories out of scope here
// (authority/package claims, encoded instructions, prompt leaks). This is a small, purpose-built
// list of literal phrases matched case-insensitively on the raw text (plan Q2; separate on
// purpose, by lead answer 25 Oct 2026).
const OVERRIDE_PHRASES: readonly RegExp[] = [
  // Role-play / persona override.
  /\byou are\s+dan\b/gi,
  /\bact as\s+(?:if\s+)?(?:a|an|my)?\s*[\w\s-]{0,40}/gi,
  /\bpretend\s+(?:you are|to be)\s+[\w\s-]{0,40}/gi,
  /\b(?:developer|god|admin)\s+mode\s*(?:enabled)?\b/gi,
  /\bno rules\b/gi,
  /\bunrestricted\b/gi,
  /\bunfiltered\b/gi,
  // Rule / instruction override.
  /\b(?:ignore|disregard|forget|bypass)\s+(?:all|any)?\s*(?:previous|above)?\s*instructions?\b/gi,
  /\b(?:ignore|disregard|forget|bypass)\s+(?:all|any)?\s*(?:previous|above)?\s*rules?\b/gi,
  /\byour rules don'?t apply\b/gi,
  /\boverride your rules\b/gi,
];

/**
 * Removes literal role-play and rule-override phrases from `text`, case-insensitively, then
 * collapses the resulting whitespace. Pure, no model call.
 */
export function stripOverridePhrases(text: string): string {
  let out = text;
  for (const phrase of OVERRIDE_PHRASES) {
    out = out.replace(phrase, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}
