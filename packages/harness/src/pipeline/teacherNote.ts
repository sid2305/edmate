// Task 5.10 (§ Ask the teacher 5, § Staying true to the teacher "Corrections"): a teacher's answer
// or correction becomes a teacher note. This module is the one place that decides the note's text
// and its citation, so the db CorrectionStore adapter and the in-memory double cannot drift (lead
// answer Q3: an answer-only switch is a one-place change here).
//
// The text keeps the (scrubbed) question so full-text search matches the next similar question.
// The citation never carries student text: a fixed title and the answer's date only.
import { countChars, LIMITS, type SourceRef } from '@edmate/contracts';
import { HarnessError } from './errors.js';

export type TeacherNoteOrigin = 'teacher_answer' | 'correction';

/** The citation titles students see. Fixed text only. */
export const TEACHER_NOTE_TITLES: Readonly<Record<TeacherNoteOrigin, string>> = {
  teacher_answer: "Teacher's answer",
  correction: "Teacher's correction",
};

/** Each of the question and the answer, in characters, after trimming. */
export const TEACHER_NOTE_PART_MAX = LIMITS.turnTextMaxLength;

export interface TeacherNoteParts {
  question: string;
  answer: string;
}

const usable = (s: string): string | null => {
  const t = s.trim();
  return t !== '' && countChars(t) <= TEACHER_NOTE_PART_MAX ? t : null;
};

/** The trimmed parts, or `null` when either is empty after trimming or over the cap. */
export function teacherNoteParts(n: TeacherNoteParts): TeacherNoteParts | null {
  const question = usable(n.question);
  const answer = usable(n.answer);
  return question === null || answer === null ? null : { question, answer };
}

/** `Question: <q>\nAnswer: <a>`, both trimmed. Throws a fixed-text HarnessError if unusable. */
export function teacherNoteText(n: TeacherNoteParts): string {
  const p = teacherNoteParts(n);
  if (p === null) {
    throw new HarnessError('a teacher note needs a non-empty question and answer within the limit');
  }
  return `Question: ${p.question}\nAnswer: ${p.answer}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

/** `YYYY-MM-DD` (UTC) of an ISO date or timestamp string, or of epoch milliseconds. */
function dayOf(answeredOn: string | number): string | null {
  if (typeof answeredOn === 'number') {
    return Number.isFinite(answeredOn) ? new Date(answeredOn).toISOString().slice(0, 10) : null;
  }
  const m = ISO_DATE.exec(answeredOn);
  if (m === null) return null;
  const at = Date.parse(answeredOn.length === 10 ? `${answeredOn}T00:00:00Z` : answeredOn);
  if (!Number.isFinite(at)) return null;
  const [, y, mo, d] = m;
  // Reject rolled-over dates (2026-02-30) by checking the calendar date round-trips.
  const day = `${y}-${mo}-${d}`;
  const check = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return check.toISOString().slice(0, 10) === day ? new Date(at).toISOString().slice(0, 10) : null;
}

/** The note's citation: a fixed title for its origin and the answer's UTC date as the locator. */
export function teacherNoteSource(
  origin: TeacherNoteOrigin,
  answeredOn: string | number,
): SourceRef & { kind: 'teacher_note' } {
  if (!Object.hasOwn(TEACHER_NOTE_TITLES, origin)) {
    throw new HarnessError('unknown teacher note origin');
  }
  const locator = dayOf(answeredOn);
  if (locator === null) throw new HarnessError('a teacher note needs a valid answer date');
  return { title: TEACHER_NOTE_TITLES[origin], locator, kind: 'teacher_note' };
}
