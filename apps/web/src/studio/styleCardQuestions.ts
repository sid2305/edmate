// Task 8.4a: the style interview's ten questions, as fixed keys in their fixed order. What a teacher
// reads is i18n copy in messages/en.json under `styleCard` (keyed by these slugs). The topics below
// are not UI copy: they are what the drafter model is told each answer is about, so they never
// change with the teacher's locale.

export const STYLE_CARD_QUESTIONS = [
  'tone',
  'examples',
  'strictness',
  'warnings',
  'phrasing',
  'stuckStudent',
  'howMuchToTell',
  'favoritePhrase',
  'pacing',
  'wrapUp',
] as const;

export type StyleCardQuestionKey = (typeof STYLE_CARD_QUESTIONS)[number];

/** What each answer is about, for the drafter model only (never shown to a teacher). */
export const QUESTION_TOPICS: Readonly<Record<StyleCardQuestionKey, string>> = {
  tone: 'The tone of voice the teacher uses with students.',
  examples: 'The kind of examples the teacher likes to use.',
  strictness: 'How strict the teacher is about method, working and notation.',
  warnings: 'What the teacher warns students about most often.',
  phrasing: 'Words or phrasing the teacher always uses or always avoids.',
  stuckStudent: 'What the teacher does when a student is stuck.',
  howMuchToTell: 'How much the teacher tells versus asks the student to work out.',
  favoritePhrase: 'A phrase the teacher is known for.',
  pacing: 'How fast the teacher moves and when they slow down.',
  wrapUp: 'How the teacher ends an explanation or checks understanding.',
};

/** Caps on the interview a teacher submits for a draft (all within the 16 KB body cap). */
export const INTERVIEW_LIMITS = {
  answerMaxChars: 800,
  samplesMax: 3,
  sampleMaxChars: 1500,
} as const;
