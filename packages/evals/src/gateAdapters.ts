// Adapters into 7.3's generator input (task 7.4): real package configs and rows shaped like
// `teacher_eval_cases`. packages/evals does not depend on @edmate/db, so the row is a local
// structural type; the db repository's rows fit it as they are.
import type { PackageConfig } from '@edmate/contracts';
import type { AgentPackage, AnswerableItem } from './perAgentSuite.js';

/** The fields of a `teacher_eval_cases` row the generator needs. */
export interface TeacherEvalCaseLike {
  id: string;
  moduleId: string;
  question: string;
  answer: string;
}

export function agentPackagesFromConfigs(
  configs: readonly PackageConfig[],
  sourceLabel: (config: PackageConfig) => string,
): AgentPackage[] {
  return configs.map((c) => ({
    id: c.id,
    name: c.name,
    moduleIds: [...c.moduleIds],
    lockedReply: c.lockedReply,
    sourceLabel: sourceLabel(c),
  }));
}

/** Approved teacher answers as answerable items, labelled by row id (never by teacher text). */
export function answerableFromTeacherEvalCases(
  rows: readonly TeacherEvalCaseLike[],
): AnswerableItem[] {
  return rows.map((r) => ({
    id: r.id,
    moduleId: r.moduleId,
    question: r.question,
    answer: r.answer,
    provenance: 'teacher-answer',
    sourceLabel: `teacher_eval_cases#${r.id}`,
  }));
}
