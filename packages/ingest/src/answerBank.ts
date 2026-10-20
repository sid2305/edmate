// Task 5.6a Phase B: practice banks and answer keys are never chunked or indexed, so they can never
// reach the model as retrieved context. `assertNotAnswerBank` is called by `indexDocument` on every
// parsed source, before chunking, and throws a fixed, non-leaking `IngestError` (no input text, no
// title) when the source is a bank by name or by shape. This is a name-and-shape refusal only: a
// teacher worksheet that happens to contain an answer line (e.g. "Answer: 7") is not a bank and is
// not refused here (that is a product question for later uploads, task 8.x).

import { IngestError } from './errors.js';
import type { ParsedUnit } from './types.js';

const BANK_PATH_SEGMENTS = new Set(['question-bank', 'rubric-answers']);
const YAML_FILE_NAME = /\.ya?ml$/i;

// Content-pack bank shapes (packages/content): a QuestionBankItem has both `question:` and
// `answer:`; a RubricAnswer has both `studentAnswer:` and `rubricNotes:`. Matched case-sensitively,
// as a YAML mapping key (a word boundary before the key keeps this from matching inside another
// word or a differently-cased label such as "Answer: 7" in an ordinary worksheet).
const QUESTION_BANK_KEYS = [/\bquestion:/, /\banswer:/] as const;
const RUBRIC_ANSWER_KEYS = [/\bstudentAnswer:/, /\brubricNotes:/] as const;

function namesABankPath(sourceTitle: string): boolean {
  const segments = sourceTitle.split(/[/\\]/);
  if (segments.some((segment) => BANK_PATH_SEGMENTS.has(segment))) return true;
  const name = segments.at(-1) ?? '';
  return YAML_FILE_NAME.test(name);
}

function hasBankShape(units: readonly ParsedUnit[]): boolean {
  const text = units.map((u) => u.text).join('\n');
  const isQuestionBank = QUESTION_BANK_KEYS.every((key) => key.test(text));
  const isRubricAnswer = RUBRIC_ANSWER_KEYS.every((key) => key.test(text));
  return isQuestionBank || isRubricAnswer;
}

/**
 * Throws a fixed `IngestError('validation', …)` when `sourceTitle` names a bank path
 * (`question-bank/`, `rubric-answers/`, or any `.yaml`/`.yml` file) or when `units` has the
 * content-pack bank shape. The thrown error never quotes `sourceTitle` or any unit text.
 */
export function assertNotAnswerBank(sourceTitle: string, units: readonly ParsedUnit[]): void {
  if (namesABankPath(sourceTitle) || hasBankShape(units)) {
    throw new IngestError(
      'validation',
      false,
      'practice banks and answer keys are never indexed',
    );
  }
}
