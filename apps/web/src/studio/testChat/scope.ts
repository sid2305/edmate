// The teacher's test-chat scope (task 8.5). The teacher id always comes from the signed-in
// principal, never from a request body. Unlike the student flow's live-only `studentTurnScope`,
// any status is previewable (drafts included: this is "test before publish").
import { studentScope, teacherScope, type StudentScope, type TeacherScope } from '@edmate/db';
import type { Principal } from '../../auth/guard';

export interface TeacherAgents {
  /** The scope's teacher's agent, any status; null when missing or another teacher's. */
  get(scope: TeacherScope, agentId: string): Promise<{ status: string } | null>;
}

/** The principal's teacher scope when the agent is theirs, else null. */
export async function teacherTestChatScope(
  agents: TeacherAgents,
  principal: Principal,
  agentId: string,
): Promise<TeacherScope | null> {
  const scope = teacherScope({ teacherId: principal.userId }, 'testChatScope');
  const agent = await agents.get(scope, agentId);
  return agent === null ? null : scope;
}

/** A preview turn's student x teacher scope: the student is the teacher themself. */
export function previewScope(scope: TeacherScope): StudentScope {
  return studentScope({ studentId: scope.teacherId, teacherId: scope.teacherId }, 'testChatScope');
}
