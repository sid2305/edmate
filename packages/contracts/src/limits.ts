// Limits stated in the Core contracts comments. `admit` (task 3.2) and the studio reuse these
// instead of copying the numbers.
export const LIMITS = {
  /** TurnInput.text: at most 4,000 characters (Unicode code points). */
  turnTextMaxChars: 4000,
  /** TurnInput.attachments: at most 2. */
  turnAttachmentsMax: 2,
  /** StyleCard.text: at most 300 words. */
  styleCardMaxWords: 300,
  /** LearnerProfile.lastSummary: at most 60 words. */
  lastSummaryMaxWords: 60,
  /** Help ladder rungs run 0 to 4. */
  helpRungMin: 0,
  helpRungMax: 4,

  // Caps chosen in fix round 1 (not in the spec; see the 0.3 handoff decisions).
  /** Ids: letters, digits, `_` and `-`, at most 128 characters. */
  idMaxLength: 128,
  /** Attachment.storageKey: at most 200 characters. */
  storageKeyMaxLength: 200,
  /** Attachment.bytes: at most 20 MB. */
  attachmentMaxBytes: 20 * 1024 * 1024,
  /** TurnInput.skillPayload: at most 16 KB of JSON (UTF-16 units of JSON.stringify). */
  skillPayloadMaxJsonLength: 16 * 1024,
  /** TurnInput.text: a cheap UTF-16 length cap checked before the code-point count. */
  turnTextMaxLength: 8000,
  /** GuardResult reason: at most 500 characters. */
  guardReasonMaxLength: 500,
  /** Model-produced text (GuardResult rewrite text, SafetyAlert excerpt): at most 8,000. */
  modelTextMaxLength: 8000,
  /** LocalePack.piiPatterns: each at most 500 characters. */
  piiPatternMaxLength: 500,
} as const;

/** Characters as Unicode code points, so an emoji or a Devanagari letter counts once per code point. */
export function countChars(text: string): number {
  return [...text].length;
}

/** Words as runs of non-whitespace. Empty or whitespace-only text has 0 words. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}
