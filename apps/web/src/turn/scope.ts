// The student x teacher scope of a turn (task 9.4). The student id always comes from the signed-in
// principal, never from a request body; the teacher is the live agent's owner.
import { studentScope, type StudentScope } from '@edmate/db';
import type { Principal } from '../auth/guard';

export interface AgentOwners {
  /** The owner of a live agent; null for a draft, suspended or missing one. */
  owner(scope: { agentId: string }): Promise<{ teacherId: string } | null>;
}

/** The principal's scope with the agent's teacher, or null when the agent is not live. */
export async function studentTurnScope(
  agents: AgentOwners,
  principal: Principal,
  agentId: string,
): Promise<StudentScope | null> {
  const owner = await agents.owner({ agentId });
  if (owner === null) return null;
  return studentScope({ studentId: principal.userId, teacherId: owner.teacherId }, 'turnScope');
}
