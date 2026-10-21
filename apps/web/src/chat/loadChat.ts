// Task 9.4 Phase C: what the /learn/[agentId] page loads before rendering the chat.
// 1. The student, through the page guard (consent done: `clearance: 'agent'`), before anything
//    touches the database.
// 2. The agent must be live (else not found); the scope is the principal with the agent's owner.
// 3. `?s=` is used only when it is the student's own open session with this agent; otherwise the
//    chat starts empty and the first send starts a new session.
import type { Message } from '@edmate/contracts';
import type { StudentScope } from '@edmate/db';
import type { Principal } from '../auth/guard';
import { StartSessionSchema } from '../turn/clientInput';
import { studentTurnScope, type AgentOwners } from '../turn/scope';
import type { ChatMessage } from './ChatView';

/** The newest messages shown when a session is reopened. */
export const HISTORY_LIMIT = 50;

const IdSchema = StartSessionSchema.shape.agentId;

export interface ChatRepos {
  agents: AgentOwners;
  sessions: {
    get(scope: StudentScope, sessionId: string): Promise<{ agentId: string; endedAt: string | null } | null>;
  };
  messages: { history(scope: StudentScope, sessionId: string, limit: number): Promise<Message[]> };
}

export interface ChatPageDeps {
  /** The page guard: a student with consent done, or a redirect / not-found (throws). */
  requireStudent(): Promise<Principal>;
  /** Opened only after the guard passed. */
  repos(): ChatRepos;
  notFound(): never;
}

export interface ChatPageData {
  agentId: string;
  sessionId: string | null;
  history: ChatMessage[];
}

function toChatMessage(m: Message): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    ...(m.sources === undefined ? {} : { sources: m.sources }),
  };
}

export async function loadChat(
  deps: ChatPageDeps,
  rawAgentId: unknown,
  rawSessionId: unknown,
): Promise<ChatPageData> {
  const principal = await deps.requireStudent();
  const agent = IdSchema.safeParse(rawAgentId);
  if (!agent.success) return deps.notFound();
  const agentId = agent.data;
  const repos = deps.repos();
  const scope = await studentTurnScope(repos.agents, principal, agentId);
  if (scope === null) return deps.notFound();
  const empty: ChatPageData = { agentId, sessionId: null, history: [] };
  const s = IdSchema.safeParse(rawSessionId);
  if (!s.success) return empty;
  const session = await repos.sessions.get(scope, s.data);
  if (session === null || session.endedAt !== null || session.agentId !== agentId) return empty;
  const history = await repos.messages.history(scope, s.data, HISTORY_LIMIT);
  return { agentId, sessionId: s.data, history: history.map(toChatMessage) };
}
