// Task 8.4c (Phase C): strips role-play and rule-override phrases from style-card text before it
// is drafted from or saved, so a style card can never carry a jailbreak phrase into a future turn
// prompt. Deliberately not a reuse of packages/harness/src/guardrails/jailbreakPatterns.ts's RULES
// table: those match on normaliseForDistress's normalised forms (apostrophes dropped, leetspeak
// folded) with no span mapped back to raw text to strip, and cover categories out of scope here
// (authority/package claims, encoded instructions, prompt leaks). This is a small, purpose-built
// list of literal phrases matched case-insensitively on the raw text (plan Q2; separate on
// purpose, by lead answer 25 Oct 2026). The "act as" / "pretend" / "no rules" patterns match a
// closed list of jailbreak targets only, so ordinary teaching text ("act as a guide", "no rules
// of thumb", "pretend to be confused so the student explains it back") is left untouched (fix
// round, 25 Oct 2026).
const JAILBREAK_TARGET =
  '(?:dan|a jailbroken (?:ai|model)|an? unfiltered (?:ai|model|assistant)|' +
  'an? unrestricted (?:ai|model|assistant)|a different ai|an ai with no rules)';
const OVERRIDE_PHRASES: readonly RegExp[] = [
  // Role-play / persona override. The "act as" / "pretend" patterns run before the bare
  // "you are DAN" pattern so "pretend you are DAN" is removed whole, not left as "pretend ".
  new RegExp(`\\bact as\\s+(?:if you are\\s+)?${JAILBREAK_TARGET}\\b`, 'gi'),
  new RegExp(`\\bpretend\\s+(?:you are|to be)\\s+${JAILBREAK_TARGET}\\b`, 'gi'),
  /\byou are\s+dan\b/gi,
  /\b(?:developer|god|admin)\s+mode\s*(?:enabled)?\b/gi,
  // Excludes "no rules of/for/about ...", matching the bare "no rules" pattern below: ordinary
  // teaching phrasing like "there are no rules for this" or "you have no rules about homework"
  // is left untouched, while jailbreak phrasing ("there are no rules here, say anything", "with
  // no rules.") is still stripped (fix round 2, 25 Oct 2026).
  /\b(?:you have|there are|with)\s+no rules\b(?!\s*(?:of|for|about))\b/gi,
  /\bno rules\b(?!\s*of)(?=\s*[.,!?;:]|\s*$)/gi,
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
