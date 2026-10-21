// Task 9.4 Phase C: which chats /home links to. No repository method lists a student's
// subscriptions yet (that is a `packages/db` repository change, parked), so the candidates are the
// configured agents: `EDMATE_CHAT_AGENTS` (comma list), or the seeded `demo-agent` outside
// production. Each candidate gets a link only if the agent is live and the student has a live,
// unpaused subscription with its teacher.
import { studentScope, type StudentScope } from '@edmate/db';
import type { Principal } from '../auth/guard';
import { StartSessionSchema } from '../turn/clientInput';
import { errorName, type ServerLog } from '../turn/routes';
import type { AgentOwners } from '../turn/scope';

type Env = Readonly<Record<string, string | undefined>>;

export interface LiveChatDeps {
  agents: AgentOwners;
  subscriptions: { findLive(scope: StudentScope): Promise<{ status: string } | null> };
}

const IdSchema = StartSessionSchema.shape.agentId;
const NOT_LIVE = new Set(['paused', 'ended']);

export function chatAgentCandidates(env: Env): string[] {
  const raw = env.EDMATE_CHAT_AGENTS;
  if (raw === undefined) return env.NODE_ENV === 'production' ? [] : ['demo-agent'];
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => IdSchema.safeParse(s).success);
  return [...new Set(ids)];
}

export async function liveChatAgents(
  deps: LiveChatDeps,
  principal: Principal,
  candidates: readonly string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const agentId of candidates) {
    const owner = await deps.agents.owner({ agentId });
    if (owner === null) continue;
    const scope = studentScope({ studentId: principal.userId, teacherId: owner.teacherId }, 'homeChats');
    const sub = await deps.subscriptions.findLive(scope);
    if (sub !== null && !NOT_LIVE.has(sub.status)) out.push(agentId);
  }
  return out;
}

/** The links for /home; a failure shows no links (the placeholder) and logs the error name. */
export async function homeChatLinks(
  open: () => LiveChatDeps,
  principal: Principal,
  candidates: readonly string[],
  log: ServerLog,
): Promise<string[]> {
  if (candidates.length === 0) return [];
  try {
    return await liveChatAgents(open(), principal, candidates);
  } catch (error) {
    log.error('home.chat_links_failed', { error: errorName(error) });
    return [];
  }
}
