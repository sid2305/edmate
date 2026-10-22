// Task 8.5 Phase C: what the /teacher/test-chat/[agentId] page loads before rendering.
// 1. The teacher, through the page guard, before anything touches the database.
// 2. The agent must be the teacher's own (any status: drafts are previewable), else not found.
// 3. The agent's previewable packages (newest first; ones with at least one version) and the
//    teacher's modules (for the correction form's module picker), both read in the teacher's scope.
// No `?s=` reopen in v1 (plan open question 2): every page load starts a fresh preview session.
import type { TeacherPackageSummary, TeacherScope } from '@edmate/db';
import type { Principal } from '../../auth/guard';
import { StartSessionSchema } from '../../turn/clientInput';
import { teacherTestChatScope, type TeacherAgents } from './scope';

const IdSchema = StartSessionSchema.shape.agentId;

export interface TestChatModule {
  id: string;
  title: string;
}

export interface TestChatRepos {
  agents: TeacherAgents;
  packageVersions: {
    listForAgent(scope: TeacherScope, agentId: string): Promise<TeacherPackageSummary[]>;
  };
  outline: {
    getOutline(scope: TeacherScope): Promise<{ modules: readonly TestChatModule[] } | null>;
  };
}

export interface TestChatPageDeps {
  /** The page guard: a teacher, or a redirect / not-found (throws). */
  requireTeacher(): Promise<Principal>;
  /** Opened only after the guard passed. */
  repos(): TestChatRepos;
  notFound(): never;
}

export interface TestChatPageData {
  agentId: string;
  packages: TeacherPackageSummary[];
  modules: TestChatModule[];
}

export async function loadTestChat(deps: TestChatPageDeps, rawAgentId: unknown): Promise<TestChatPageData> {
  const principal = await deps.requireTeacher();
  const agent = IdSchema.safeParse(rawAgentId);
  if (!agent.success) return deps.notFound();
  const agentId = agent.data;
  const repos = deps.repos();
  const scope = await teacherTestChatScope(repos.agents, principal, agentId);
  if (scope === null) return deps.notFound();
  const [packages, outline] = await Promise.all([
    repos.packageVersions.listForAgent(scope, agentId),
    repos.outline.getOutline(scope),
  ]);
  const modules = (outline?.modules ?? []).map((m) => ({ id: m.id, title: m.title }));
  return { agentId, packages, modules };
}
