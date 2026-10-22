// The demo teacher as 7.3's generator input (task 7.3's test adapter, shared with 7.4's gate
// tests). Loads the committed, public content/demo-teacher tree and mixes in two synthetic
// approved-draft rows. Test code: not exported from the package and left out of the build.
import { fileURLToPath } from 'node:url';
import {
  loadDemoTeacherContent,
  type DemoTeacherContent,
  type PackageDraft,
} from '@edmate/content';
import type {
  AgentPackage,
  AnswerableItem,
  OutOfCourseItem,
  PerAgentSuiteInput,
} from './perAgentSuite.js';

export const DEMO_DIR = fileURLToPath(new URL('../../../content/demo-teacher', import.meta.url));
const SOURCE = 'content/demo-teacher';
// The same fixed ids the db seed gives the demo packages (packages/db/src/seed.ts DEMO_IDS).
export const PACKAGE_IDS = { free: 'demo-package-free', paid: 'demo-package-paid' } as const;

/** Synthetic rows shaped like `teacher_eval_cases` (approved drafts); not real teacher data. */
const APPROVED_DRAFT_ROWS = [
  {
    id: 'synthetic-row-1',
    moduleId: 'values-variables',
    question: 'Is a variable name allowed to start with a digit?',
    answer: 'No. A name can contain digits but must start with a letter or an underscore.',
  },
  {
    id: 'synthetic-row-2',
    moduleId: 'loops',
    question: 'Does range(3) include the number 3?',
    answer: 'No. range(3) gives 0, 1 and 2; the stop number is never included.',
  },
];

function toPackage(key: keyof typeof PACKAGE_IDS, draft: PackageDraft): AgentPackage {
  return {
    id: PACKAGE_IDS[key],
    name: draft.name,
    moduleIds: draft.moduleIds,
    lockedReply: draft.lockedReply,
    sourceLabel: `${SOURCE}/packages/${key}.yaml`,
  };
}

export function adapt(content: DemoTeacherContent): PerAgentSuiteInput {
  const answerable: AnswerableItem[] = [];
  const outOfCourse: OutOfCourseItem[] = [];
  for (const file of content.questionBank) {
    for (const item of file.items) {
      answerable.push({
        id: item.id,
        moduleId: item.moduleId,
        question: item.question,
        answer: item.answer,
        provenance: 'question-bank',
        sourceLabel: `${SOURCE}/${file.file}#${item.id}`,
      });
    }
  }
  for (const item of content.qaRecall) {
    const sourceLabel = `${SOURCE}/qa-recall.yaml#${item.id}`;
    if ('outOfCourse' in item) {
      outOfCourse.push({
        id: item.id,
        question: item.question,
        provenance: 'qa-recall',
        sourceLabel,
      });
    } else {
      // Keyed on the module that answers it (qr-15..18: asked from a free module, answered in a
      // paid one), so the free package gets a locked case for it.
      answerable.push({
        id: item.id,
        moduleId: item.expectedModuleId,
        question: item.question,
        provenance: 'qa-recall',
        sourceLabel,
      });
    }
  }
  for (const row of APPROVED_DRAFT_ROWS) {
    answerable.push({
      ...row,
      provenance: 'teacher-answer',
      sourceLabel: `teacher_eval_cases#${row.id}`,
    });
  }
  return {
    teacherId: 'demo-teacher',
    agentId: 'demo-agent',
    packages: [toPackage('free', content.packages.free), toPackage('paid', content.packages.paid)],
    answerable,
    outOfCourse,
  };
}

/** The demo teacher's per-agent suite input, loaded from disk. */
export function demoSuiteInput(): PerAgentSuiteInput {
  return adapt(loadDemoTeacherContent(DEMO_DIR));
}
