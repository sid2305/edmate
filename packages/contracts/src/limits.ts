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
} as const;

/** Characters as Unicode code points, so an emoji or a Devanagari letter counts once per code point. */
export function countChars(text: string): number {
  return [...text].length;
}

/** Words as runs of non-whitespace. Empty or whitespace-only text has 0 words. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}
