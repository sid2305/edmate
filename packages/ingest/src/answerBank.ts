// Task 5.6a Phase B: practice banks and answer keys are never chunked or indexed, so they can never
// reach the model as retrieved context. `assertNotAnswerBank` is called by `indexDocument` on every
// parsed source, before chunking, and throws a fixed, non-leaking `IngestError` (no input text, no
// title) when the source is a bank by name or by shape. This is a name-and-shape refusal only: a
// teacher worksheet that happens to contain an answer line (e.g. "Answer: 7") is not a bank and is
// not refused here (that is a product question for later uploads, task 8.x).
//
// Task 5.6c Phase C: the title and the text are folded (Unicode NFKC, then zero-width/format
// characters dropped) before every check, so a fullwidth letter or an embedded zero-width space
// cannot slip a bank past the refusal. The shape rule runs on the raw source lines when they are
// available (markdown and text sources): a key must start its own line (after any markdown list,
// quote or heading markers and emphasis) or follow "{" or "," as a YAML flow key, so an ordinary sentence that happens to contain "a question: ... the
// answer: ..." is not refused. When raw lines are not available (PDF, DOCX, slides), the shape rule
// falls back to the looser word-boundary check across the parsed units' text, as before. A JSON-array
// bank or a markdown-table bank is not refused by either rule; that is left to the upload scope
// (task 8.x).

import { IngestError } from './errors.js';
import type { ParsedUnit } from './types.js';

const BANK_PATH_SEGMENTS = new Set(['question-bank', 'rubric-answers']);
const YAML_FILE_NAME = /\.ya?ml$/i;

// Content-pack bank shapes (packages/content): a QuestionBankItem has both `question:` and
// `answer:`; a RubricAnswer has both `studentAnswer:` and `rubricNotes:`. The keys are matched
// case-sensitively, as today.
const QUESTION_BANK_KEY_NAMES = ['question', 'answer'] as const;
const RUBRIC_ANSWER_KEY_NAMES = ['studentAnswer', 'rubricNotes'] as const;

// Fallback (no raw lines): word boundary before the key, so it still matches inside a joined block
// of text but not inside a differently-cased label such as "Answer: 7" in an ordinary worksheet.
const QUESTION_BANK_KEYS = [/\bquestion:/, /\banswer:/] as const;
const RUBRIC_ANSWER_KEYS = [/\bstudentAnswer:/, /\brubricNotes:/] as const;

/** NFKC-normalises and drops zero-width/format characters (Unicode category Cf), so a homoglyph or
 * an embedded zero-width character cannot hide a bank's title or key from the checks below. */
function fold(input: string): string {
  return input.normalize('NFKC').replace(/\p{Cf}/gu, '');
}

function namesABankPath(sourceTitle: string): boolean {
  const segments = fold(sourceTitle).split(/[/\\]/);
  if (segments.some((segment) => BANK_PATH_SEGMENTS.has(segment.toLowerCase()))) return true;
  const name = segments.at(-1) ?? '';
  return YAML_FILE_NAME.test(name);
}

/** A line matches a key when, at the start of the line (after trimming leading indentation), there
 * is any run of markdown markers (a "-", "*" or "+" list marker, a "1." or "1)" numbered marker, a
 * ">" quote, a "#" heading or a "|" cell, each with optional whitespace after it), then any opening
 * emphasis, quote or bracket ("**", "_", a quote, "{", "["), the key, any closing emphasis or quote,
 * optional whitespace and then ":". So "* question:", "1. question:", "> question:",
 * "## question:", "**question:**" and "-\tquestion:" all match, as the units check on main did
 * (5.6c fix round). Case-sensitive, like the fallback check. Linear: the marker alternatives are
 * disjoint and each numbered marker needs its terminator. */
function lineKeyPattern(key: string): RegExp {
  return new RegExp(`^(?:(?:[-*+>#|]|\\d+[.)])\\s*)*[*_"'{\\[]*${key}[*_"']*\\s*:`);
}

/** A YAML flow mapping key ("- {question: 2+2, answer: 4}"): the key follows "{" or "," anywhere on
 * the line. Unquoted only, so a compact JSON array bank stays the documented 8.x gap. */
function flowKeyPattern(key: string): RegExp {
  return new RegExp(`[{,]\\s*${key}\\s*:`);
}

function hasKeyOnItsOwnLine(lines: readonly string[], key: string): boolean {
  const patterns = [lineKeyPattern(key), flowKeyPattern(key)];
  return lines.some((line) => patterns.some((pattern) => pattern.test(line)));
}

function hasBankShapeInLines(rawText: string): boolean {
  const lines = fold(rawText)
    .split(/\r\n?|\n/)
    .map((line) => line.trimStart());
  const isQuestionBank = QUESTION_BANK_KEY_NAMES.every((key) => hasKeyOnItsOwnLine(lines, key));
  const isRubricAnswer = RUBRIC_ANSWER_KEY_NAMES.every((key) => hasKeyOnItsOwnLine(lines, key));
  return isQuestionBank || isRubricAnswer;
}

function hasBankShapeInUnits(units: readonly ParsedUnit[]): boolean {
  const text = fold(units.map((u) => u.text).join('\n'));
  const isQuestionBank = QUESTION_BANK_KEYS.every((key) => key.test(text));
  const isRubricAnswer = RUBRIC_ANSWER_KEYS.every((key) => key.test(text));
  return isQuestionBank || isRubricAnswer;
}

function hasBankShape(units: readonly ParsedUnit[], rawText: string | undefined): boolean {
  return rawText !== undefined ? hasBankShapeInLines(rawText) : hasBankShapeInUnits(units);
}

/**
 * Throws a fixed `IngestError('validation', …)` when `sourceTitle` names a bank path
 * (`question-bank/`, `rubric-answers/`, or any `.yaml`/`.yml` file, matched case-insensitively) or
 * when the source has the content-pack bank shape. The thrown error never quotes `sourceTitle` or
 * any unit text.
 *
 * `rawText` is the undecoded source text (markdown or plain text) before parsing, when the caller
 * has it; the shape check then runs on its raw lines, which keeps YAML line structure and avoids
 * refusing ordinary prose that mentions "question:" and "answer:" mid-sentence. When `rawText` is
 * omitted (PDF, DOCX, slides have no raw lines), the shape check falls back to the parsed units.
 */
export function assertNotAnswerBank(
  sourceTitle: string,
  units: readonly ParsedUnit[],
  rawText?: string,
): void {
  if (namesABankPath(sourceTitle) || hasBankShape(units, rawText)) {
    throw new IngestError(
      'validation',
      false,
      'practice banks and answer keys are never indexed',
    );
  }
}
