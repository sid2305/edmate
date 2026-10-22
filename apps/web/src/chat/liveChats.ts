// Task 9.4 Phase C: which chats /home links to. No repository method lists a student's
// subscriptions yet (that is a `packages/db` repository change, parked), so the candidates are the
// configured agents: `EDMATE_CHAT_AGENTS` (comma list), or the seeded `demo-agent` outside
// production. Each candidate gets a link only if the agent is live and the student has a live,
// unpaused subscription with its teacher.
//
// Task 9.3b (9.3/9.6e review follow-up, MEDIUM): chat, start and paused used to be three
// separate candidate scans, each re-running `agents.owner` and `subscriptions.findLive` for
// every candidate -- four scans in total once /home's own live-classes lookup is counted. Now
// `homeCandidateScan` runs that lookup exactly once per candidate (candidates run concurrently
// via `Promise.all`), and `homeLinks` classifies the one set of rows into all three lists plus
// the distinct teacher ids /home's live-classes block needs -- no second `agents.owner` pass.
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

export function chatAgentCandidates(env: Env): string[] {
  const raw = env.EDMATE_CHAT_AGENTS;
  if (raw === undefined) return env.NODE_ENV === 'production' ? [] : ['demo-agent'];
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => IdSchema.safeParse(s).success);
  return [...new Set(ids)];
}

/** One candidate's resolved owner and live-subscription status (`null` when never subscribed, or
 * ended -- `subscriptions.findLive` excludes `ended` rows in production; the explicit check in
 * `classifyHomeLinks` below is for callers/tests whose stub still returns the row). */
export interface HomeCandidate {
  agentId: string;
  teacherId: string;
  status: string | null;
}

/** The one scan: `agents.owner` then `subscriptions.findLive`, once per candidate, run
 * concurrently. A draft/suspended/unknown agent id is dropped (no owner, so no scope to read). */
export async function homeCandidateScan(
  deps: LiveChatDeps,
  principal: Principal,
  candidates: readonly string[],
): Promise<HomeCandidate[]> {
  const rows = await Promise.all(
    candidates.map(async (agentId): Promise<HomeCandidate | null> => {
      const owner = await deps.agents.owner({ agentId });
      if (owner === null) return null;
      const scope = studentScope({ studentId: principal.userId, teacherId: owner.teacherId }, 'homeChats');
      const sub = await deps.subscriptions.findLive(scope);
      return { agentId, teacherId: owner.teacherId, status: sub?.status ?? null };
    }),
  );
  return rows.filter((row): row is HomeCandidate => row !== null);
}

/**
 * Task 9.4/9.3/9.6e: one classification pass over the scan above --
 * - `chats`: a live, unpaused subscription (`trial`/`active`/`past_due`).
 * - `paused`: a `paused` subscription -- its own plan-page link, not chat. A paused subscription
 *   keeps its own chat (human answer B-49), so this is additional, not instead of `chats`.
 * - `startable`: never subscribed (`status === null`), or a subscription that `ended`. Resuming a
 *   *paused* subscription is not "startable" here -- it already has its own list (`paused`), and
 *   managing/resuming it is the plan page's job (9.6c's `resume`, shipped), not this one.
 */
export function classifyHomeLinks(rows: readonly HomeCandidate[]): {
  chats: string[];
  paused: string[];
  startable: string[];
} {
  const chats: string[] = [];
  const paused: string[] = [];
  const startable: string[] = [];
  for (const row of rows) {
    if (row.status === null || row.status === 'ended') startable.push(row.agentId);
    else if (row.status === 'paused') paused.push(row.agentId);
    else chats.push(row.agentId);
  }
  return { chats, paused, startable };
}

export interface HomeLinks {
  chats: string[];
  paused: string[];
  startable: string[];
  /** Every candidate's resolved teacher, deduplicated -- /home's live-classes block reuses this
   * instead of its own `agents.owner` pass (task 9.3b). */
  teacherIds: string[];
}

const EMPTY: HomeLinks = { chats: [], paused: [], startable: [], teacherIds: [] };

/** The /home chat+paused+startable links and teacher ids, from one shared scan; a failure shows
 * none of the three and logs the error name only. */
export async function homeLinks(
  open: () => LiveChatDeps,
  principal: Principal,
  candidates: readonly string[],
  log: ServerLog,
): Promise<HomeLinks> {
  if (candidates.length === 0) return EMPTY;
  try {
    const rows = await homeCandidateScan(open(), principal, candidates);
    const { chats, paused, startable } = classifyHomeLinks(rows);
    const teacherIds = [...new Set(rows.map((row) => row.teacherId))];
    return { chats, paused, startable, teacherIds };
  } catch (error) {
    log.error('home.links_failed', { error: errorName(error) });
    return EMPTY;
  }
}
