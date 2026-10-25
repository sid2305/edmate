// Shared demo-teacher content adapter (task 7.4a, item 8): the demo teacher's packages and q&a
// as 7.3's per-agent suite input. Shared by `apps/cli`'s `edmate gate` command (`demoInput.ts`)
// and this package's own test adapter (`demoSuiteInput.testkit.ts`), which appends its two
// synthetic `teacher-answer` rows on top of this.
import type { DemoTeacherContent, PackageDraft } from '@edmate/content';
import type { AgentPackage, AnswerableItem, OutOfCourseItem, PerAgentSuiteInput } from './perAgentSuite.js';

const SOURCE = 'content/demo-teacher';
// The same fixed ids the db seed gives the demo packages (packages/db/src/seed.ts DEMO_IDS).
export const PACKAGE_IDS = { free: 'demo-package-free', paid: 'demo-package-paid' } as const;

export function toPackage(key: keyof typeof PACKAGE_IDS, draft: PackageDraft): AgentPackage {
  return {
    id: PACKAGE_IDS[key],
    name: draft.name,
    moduleIds: draft.moduleIds,
    lockedReply: draft.lockedReply,
    sourceLabel: `${SOURCE}/packages/${key}.yaml`,
  };
}

/** The demo content as `PerAgentSuiteInput`, minus any synthetic teacher-answer rows. */
export function adaptDemoTeacherContent(content: DemoTeacherContent): PerAgentSuiteInput {
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
  return {
    teacherId: 'demo-teacher',
    agentId: 'demo-agent',
    packages: [toPackage('free', content.packages.free), toPackage('paid', content.packages.paid)],
    answerable,
    outOfCourse,
  };
}
