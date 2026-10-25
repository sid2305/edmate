// The demo teacher's packages and q&a as 7.3's per-agent suite input (task 7.4 Phase C): the
// `edmate gate` command's only agent is "demo" until the publish flow (8.7) wires real teachers
// and their `teacherEvalCases.listForTeacher` rows (Phase B). Uses the shared
// `adaptDemoTeacherContent` adapter from `@edmate/evals` (task 7.4a item 8), the same one used
// by packages/evals' tests (`demoSuiteInput.testkit.ts`), minus its two synthetic
// teacher-answer rows: the CLI has no teacher-answer source to stand in for yet.
import { fileURLToPath } from 'node:url';
import { loadDemoTeacherContent } from '@edmate/content';
import { adaptDemoTeacherContent, type PerAgentSuiteInput } from '@edmate/evals';

/** Repo-root-relative content directory the CLI reads by default (read-only, public). */
export const GATE_DEMO_CONTENT_DIR = fileURLToPath(
  new URL('../../../../../content/demo-teacher/', import.meta.url),
);

/** The demo teacher's per-agent suite input, loaded from disk (default: `content/demo-teacher`). */
export function loadDemoPerAgentInput(dir: string = GATE_DEMO_CONTENT_DIR): PerAgentSuiteInput {
  return adaptDemoTeacherContent(loadDemoTeacherContent(dir));
}
