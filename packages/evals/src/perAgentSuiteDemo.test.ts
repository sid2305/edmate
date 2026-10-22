// Task 7.3 acceptance: "the demo teacher gets >= 50 accuracy cases and >= 30 locked cases".
// Loads the committed, public content/demo-teacher tree, adapts it here (test code, not src/)
// into the generator's input, mixes in two synthetic approved-draft rows, and checks the counts.
// Nothing is written to disk.
import { fileURLToPath } from 'node:url';
import {
  loadDemoTeacherContent,
  type DemoTeacherContent,
  type PackageDraft,
} from '@edmate/content';
import { describe, expect, it } from 'vitest';
import {
  generatePerAgentSuite,
  type AgentPackage,
  type AnswerableItem,
  type OutOfCourseItem,
  type PerAgentSuiteInput,
} from './perAgentSuite.js';
import { EvalCaseSchema } from './schema.js';

const DEMO_DIR = fileURLToPath(new URL('../../../content/demo-teacher', import.meta.url));
const SOURCE = 'content/demo-teacher';
// The same fixed ids the db seed gives the demo packages (packages/db/src/seed.ts DEMO_IDS).
const PACKAGE_IDS = { free: 'demo-package-free', paid: 'demo-package-paid' } as const;

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

function adapt(content: DemoTeacherContent): PerAgentSuiteInput {
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

describe('generatePerAgentSuite on the demo teacher (task 7.3 acceptance)', () => {
  const input = adapt(loadDemoTeacherContent(DEMO_DIR));
  const cases = generatePerAgentSuite(input);

  it('gives >= 50 accuracy cases and >= 30 locked cases', () => {
    const accuracy = cases.filter((c) => c.suite === 'accuracy').length;
    const locked = cases.filter((c) => c.suite === 'locked').length;
    expect(accuracy).toBeGreaterThanOrEqual(50);
    expect(locked).toBeGreaterThanOrEqual(30);
    // Exact counts, so a content change that moves them is noticed. Accuracy 106: 37 bank items
    // (15 in free modules x 2 packages + 22 paid-only = 52), 30 recall in-course items (13
    // answered in free modules x 2 + 17 paid-only = 43), 2 synthetic rows (2 + 1), 8
    // out-of-course. Locked 49, free package only: 40 direct (22 bank + 17 recall + 1 synthetic
    // row in loops, functions, lists-dicts) + 3 module templates x 3 modules.
    expect({ accuracy, locked }).toMatchInlineSnapshot(`
      {
        "accuracy": 106,
        "locked": 49,
      }
    `);
  });

  it('produces only cases that parse, with unique ids and generated provenance', () => {
    for (const c of cases) expect(EvalCaseSchema.parse(c)).toEqual(c);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases)
      expect(c.reviewed_by).toMatch(
        /^generated:(question-bank|qa-recall|teacher-answer|locked-template)$/,
      );
    expect(cases.some((c) => c.reviewed_by === 'generated:teacher-answer')).toBe(true);
  });

  it('routes the recall items answered only in paid modules to locked for the free package', () => {
    const lockedIds = cases.filter((c) => c.suite === 'locked').map((c) => c.id);
    for (const id of ['qr-15', 'qr-16', 'qr-17', 'qr-18']) {
      expect(lockedIds).toContain(`gen-lock-demo-package-free-direct-${id}`);
    }
    expect(cases.every((c) => c.suite !== 'locked' || c.package === PACKAGE_IDS.free)).toBe(true);
  });

  it('is deterministic', () => {
    expect(generatePerAgentSuite(adapt(loadDemoTeacherContent(DEMO_DIR)))).toEqual(cases);
  });
});
