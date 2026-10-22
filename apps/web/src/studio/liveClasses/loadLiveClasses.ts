// Task 11.1b Phase B: the /teacher/live-classes page load. Same precedent as 8.9 Phase C's
// `loadQuestions`: a server-side read direct from the repositories, no HTTP round trip for the
// page's own first paint. The guard runs before any database read; the teacher is always the
// signed-in principal.
// 11.2b: also loads the pre-class question queue, both feeds (build plan § 11.2 Design 4) -- the
// student feed (`classQuestions.listQueueForTeacher`, 11.2a) and the teacher's whole open
// ask-the-teacher queue (`teacherQuestions.listGroupsForTeacher`, 5.10, shown whole -- lead
// answer Q2), each read in the same signed-in teacher's own scope.
import type {
  Repositories,
  TeacherLiveClassRow,
  TeacherPackageRow,
  TeacherQuestionGroup,
  TeacherScope,
  TopicQuestionGroup,
} from '@edmate/db';
import type { Principal } from '../../auth/guard';

export interface LiveClassesPackage {
  packageId: string;
  name: string;
}

/** Most ask-the-teacher groups shown on this page (lead answer Q2: the whole open queue). */
const ASK_QUEUE_LIMIT = 5;

export interface LiveClassesPageRepos {
  liveClasses: Pick<Repositories['liveClasses'], 'listForTeacher'>;
  packages: Pick<Repositories['packages'], 'listForTeacher'>;
  classQuestions: Pick<Repositories['classQuestions'], 'listQueueForTeacher'>;
  teacherQuestions: Pick<Repositories['teacherQuestions'], 'listGroupsForTeacher'>;
}

export interface LiveClassesPageDeps {
  /** The page guard: a teacher, or a redirect (throws). */
  requireTeacher(): Promise<Principal>;
  /** Opened only after the guard passed. */
  repos(): LiveClassesPageRepos;
}

export interface LiveClassesPageData {
  classes: TeacherLiveClassRow[];
  packages: LiveClassesPackage[];
  studentQueue: TopicQuestionGroup[];
  askQueue: TeacherQuestionGroup[];
}

function toPackage(row: TeacherPackageRow): LiveClassesPackage {
  return { packageId: row.packageId, name: row.config.name };
}

export async function loadLiveClasses(deps: LiveClassesPageDeps): Promise<LiveClassesPageData> {
  const principal = await deps.requireTeacher();
  const scope: TeacherScope = { teacherId: principal.userId };
  const repos = deps.repos();
  const [classes, packages, studentQueue, askQueue] = await Promise.all([
    repos.liveClasses.listForTeacher(scope),
    repos.packages.listForTeacher(scope),
    repos.classQuestions.listQueueForTeacher(scope),
    repos.teacherQuestions.listGroupsForTeacher(scope, { limit: ASK_QUEUE_LIMIT }),
  ]);
  return { classes, packages: packages.map(toPackage), studentQueue, askQueue };
}
