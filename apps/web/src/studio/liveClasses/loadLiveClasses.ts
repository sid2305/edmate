// Task 11.1b Phase B: the /teacher/live-classes page load. Same precedent as 8.9 Phase C's
// `loadQuestions`: a server-side read direct from the repositories, no HTTP round trip for the
// page's own first paint. The guard runs before any database read; the teacher is always the
// signed-in principal.
import type { Repositories, TeacherLiveClassRow, TeacherPackageRow, TeacherScope } from '@edmate/db';
import type { Principal } from '../../auth/guard';

export interface LiveClassesPackage {
  packageId: string;
  name: string;
}

export interface LiveClassesPageRepos {
  liveClasses: Pick<Repositories['liveClasses'], 'listForTeacher'>;
  packages: Pick<Repositories['packages'], 'listForTeacher'>;
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
}

function toPackage(row: TeacherPackageRow): LiveClassesPackage {
  return { packageId: row.packageId, name: row.config.name };
}

export async function loadLiveClasses(deps: LiveClassesPageDeps): Promise<LiveClassesPageData> {
  const principal = await deps.requireTeacher();
  const scope: TeacherScope = { teacherId: principal.userId };
  const repos = deps.repos();
  const [classes, packages] = await Promise.all([
    repos.liveClasses.listForTeacher(scope),
    repos.packages.listForTeacher(scope),
  ]);
  return { classes, packages: packages.map(toPackage) };
}
