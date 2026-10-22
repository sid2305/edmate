// Task 8.9 Phase C: the /teacher/questions page load. Reads Phase B's handoff for the exact
// response shape; this is the server-side equivalent read directly from the repositories (same
// precedent as 8.5 Phase C's `loadTestChat` — no HTTP round trip for the page's own first paint).
// The guard runs before any database read; the teacher is always the signed-in principal.
import type { Repositories, TeacherQuestionGroup, TeacherScope } from '@edmate/db';
import type { Principal } from '../../auth/guard';
import { QUESTIONS_LIST_LIMIT } from './routes';

export interface QuestionsModule {
  id: string;
  title: string;
}

export interface QuestionsPageRepos {
  teacherQuestions: Pick<Repositories['teacherQuestions'], 'listGroupsForTeacher'>;
  outline: Pick<Repositories['outline'], 'getOutline'>;
}

export interface QuestionsPageDeps {
  /** The page guard: a teacher, or a redirect (throws). */
  requireTeacher(): Promise<Principal>;
  /** Opened only after the guard passed. */
  repos(): QuestionsPageRepos;
}

export interface QuestionsPageData {
  groups: TeacherQuestionGroup[];
  modules: QuestionsModule[];
}

export async function loadQuestions(deps: QuestionsPageDeps): Promise<QuestionsPageData> {
  const principal = await deps.requireTeacher();
  const scope: TeacherScope = { teacherId: principal.userId };
  const repos = deps.repos();
  const [groups, outline] = await Promise.all([
    repos.teacherQuestions.listGroupsForTeacher(scope, { limit: QUESTIONS_LIST_LIMIT }),
    repos.outline.getOutline(scope),
  ]);
  const modules = (outline?.modules ?? []).map((m) => ({ id: m.id, title: m.title }));
  return { groups, modules };
}
