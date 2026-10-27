// Task 9.4 Phase C / 9.3b / 9.6e: which chats /home links to, in one shared pass.
//
// Task 9.4a Phase C: the **chat** and **paused** links come from the student's own subscriptions,
// one query across every teacher (`subscriptions.listLiveForStudent`, keyed by the signed-in
// principal's own id only -- never a client-supplied id). No env var picks them any more.
//
// The **startable** list ("start a package" links, not chat links) still comes from the
// configured candidates, `EDMATE_CHAT_AGENTS` (comma list), or the seeded `demo-agent` outside
// production (lead answer 2, 22 Oct 2026: kept until a discovery-backed "browse more agents"
// task replaces it). A candidate is startable when its agent is live and the student has no live
// subscription to it -- so an agent the student already chats with never double-lists.
import type { Entitlement } from '@edmate/contracts';
import type { Principal } from '../auth/guard';
import { StartSessionSchema } from '../turn/clientInput';
import { errorName, type ServerLog } from '../turn/routes';
import type { AgentOwners } from '../turn/scope';

type Env = Readonly<Record<string, string | undefined>>;

/** One of the student's not-ended subscriptions, with the live agent it is for. */
export interface LiveChat {
  agentId: string;
  teacherId: string;
  status: Entitlement['status'];
}

/** One of the student's not-ended subscriptions whose current package's agent is no longer
 * `live` (suspended or back to draft) -- task 9.3f Phase C / B-49. */
export interface UnavailableChat {
  agentId: string;
  teacherId: string;
}

export interface LiveChatDeps {
  agents: AgentOwners;
  subscriptions: {
    listLiveForStudent(studentId: string): Promise<readonly LiveChat[]>;
    listUnavailableForStudent(studentId: string): Promise<readonly UnavailableChat[]>;
  };
}

const IdSchema = StartSessionSchema.shape.agentId;

export function chatAgentCandidates(env: Env): string[] {
  const raw = env.EDMATE_CHAT_AGENTS;
  if (raw === undefined) return env.NODE_ENV === 'production' ? [] : ['demo-agent'];
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => IdSchema.safeParse(s).success);
  return [...new Set(ids)];
}

/**
 * The student's live list, split for /home:
 * - `chats`: a live, unpaused subscription (`trial`/`active`/`past_due`).
 * - `paused`: a `paused` subscription -- its own plan-page link. A paused subscription keeps its
 *   own chat (human answer B-49), so this is additional, not instead of `chats`.
 * An `ended` row (the real query never returns one) is in neither list.
 */
export function classifyHomeLinks(live: readonly LiveChat[]): {
  chats: string[];
  paused: string[];
} {
  const chats: string[] = [];
  const paused: string[] = [];
  for (const row of live) {
    if (row.status === 'ended') continue;
    if (row.status === 'paused') paused.push(row.agentId);
    else chats.push(row.agentId);
  }
  return { chats, paused };
}

export interface HomeLinks {
  chats: string[];
  paused: string[];
  startable: string[];
  /** The live list's teachers, deduplicated -- /home's live-classes block reuses this. Startable
   * candidates are not part of it. */
  teacherIds: string[];
  /** Agent ids of a not-ended subscription whose agent is no longer live -- /home shows one
   * blame-free line for these, no teacher name (task 9.3f Phase C / B-49). Deduplicated. */
  unavailable: string[];
}

const EMPTY: HomeLinks = { chats: [], paused: [], startable: [], teacherIds: [], unavailable: [] };

/** The /home chat, paused, startable and unavailable links and teacher ids. A failure shows none
 * of them and logs the error name only (one catch for the whole pass -- an extra failure mode for
 * one more read-only field is not worth its own try/catch). */
export async function homeLinks(
  open: () => LiveChatDeps,
  principal: Principal,
  candidates: readonly string[],
  log: ServerLog,
): Promise<HomeLinks> {
  try {
    const deps = open();
    const [live, unavailableRows] = await Promise.all([
      deps.subscriptions.listLiveForStudent(principal.userId),
      deps.subscriptions.listUnavailableForStudent(principal.userId),
    ]);
    // `classifyHomeLinks` is the only place that drops an `ended` row (the real query never
    // returns one, but a test double may) -- `liveIds`/`teacherIds` below are derived from its
    // `chats`/`paused` output, not from a second `status !== 'ended'` check on `live` (9.4e item
    // 10: that was a duplicate of the check `classifyHomeLinks` already does).
    const { chats, paused } = classifyHomeLinks(live);
    const liveIds = new Set([...chats, ...paused]);
    const owned = await Promise.all(
      candidates
        .filter((agentId) => !liveIds.has(agentId))
        .map(async (agentId) => ((await deps.agents.owner({ agentId })) === null ? null : agentId)),
    );
    const startable = owned.filter((agentId): agentId is string => agentId !== null);
    const teacherIds = [
      ...new Set(live.filter((row) => liveIds.has(row.agentId)).map((row) => row.teacherId)),
    ];
    const unavailable = [...new Set(unavailableRows.map((row) => row.agentId))];
    return { chats, paused, startable, teacherIds, unavailable };
  } catch (error) {
    log.error('home.links_failed', { error: errorName(error) });
    return EMPTY;
  }
}
