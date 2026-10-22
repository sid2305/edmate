// The demo teacher's packages and q&a as 7.3's per-agent suite input (task 7.4 Phase C): the
// `edmate gate` command's only agent is "demo" until the publish flow (8.7) wires real teachers
// and their `teacherEvalCases.listForTeacher` rows (Phase B). A src copy of the same adapter used
// by packages/evals' tests (`demoSuiteInput.testkit.ts`), minus its two synthetic
// teacher-answer rows: the CLI has no teacher-answer source to stand in for yet.
import { fileURLToPath } from 'node:url';
import { loadDemoTeacherContent, type DemoTeacherContent, type PackageDraft } from '@edmate/content';
import type {
  AgentPackage,
  AnswerableItem,
  OutOfCourseItem,
  PerAgentSuiteInput,
} from '@edmate/evals';

/** Repo-root-relative content directory the CLI reads by default (read-only, public). */
export const GATE_DEMO_CONTENT_DIR = fileURLToPath(
  new URL('../../../../../content/demo-teacher/', import.meta.url),
);
const SOURCE = 'content/demo-teacher';
// The same fixed ids the db seed gives the demo packages (packages/db/src/seed.ts DEMO_IDS).
const PACKAGE_IDS = { free: 'demo-package-free', paid: 'demo-package-paid' } as const;

function toPackage(key: keyof typeof PACKAGE_IDS, draft: PackageDraft): AgentPackage {
  return {
    id: PACKAGE_IDS[key],
    name: draft.name,
    moduleIds: draft.moduleIds,
    lockedReply: draft.lockedReply,
    sourceLabel: `${SOURCE}/packages/${key}.yaml`,
  };
}

/** The demo content as `PerAgentSuiteInput`. */
export function adaptDemoContent(content: DemoTeacherContent): PerAgentSuiteInput {
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

/** The demo teacher's per-agent suite input, loaded from disk (default: `content/demo-teacher`). */
export function loadDemoPerAgentInput(dir: string = GATE_DEMO_CONTENT_DIR): PerAgentSuiteInput {
  return adaptDemoContent(loadDemoTeacherContent(dir));
}
