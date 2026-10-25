// The demo teacher as 7.3's generator input (task 7.3's test adapter, shared with 7.4's gate
// tests). Loads the committed, public content/demo-teacher tree via the shared
// `demoContentAdapter.ts` and mixes in two synthetic approved-draft rows. Test code: not
// exported from the package and left out of the build.
import { fileURLToPath } from 'node:url';
import { loadDemoTeacherContent } from '@edmate/content';
import { adaptDemoTeacherContent, PACKAGE_IDS } from './demoContentAdapter.js';
import type { PerAgentSuiteInput } from './perAgentSuite.js';

export const DEMO_DIR = fileURLToPath(new URL('../../../content/demo-teacher', import.meta.url));
export { PACKAGE_IDS };

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

export function adapt(content: Parameters<typeof adaptDemoTeacherContent>[0]): PerAgentSuiteInput {
  const base = adaptDemoTeacherContent(content);
  return {
    ...base,
    answerable: [
      ...base.answerable,
      ...APPROVED_DRAFT_ROWS.map((row) => ({
        ...row,
        provenance: 'teacher-answer' as const,
        sourceLabel: `teacher_eval_cases#${row.id}`,
      })),
    ],
  };
}

/** The demo teacher's per-agent suite input, loaded from disk. */
export function demoSuiteInput(): PerAgentSuiteInput {
  return adapt(loadDemoTeacherContent(DEMO_DIR));
}
