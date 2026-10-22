// Task 9.1 Phase C: the student home route. Thin -- `requireRole` gates it, `HomeView` is the
// actual markup (kept pure so it can be tested directly, no server-only guard to stub).
// 9.4: links to the chats of the student's live subscriptions (see src/chat/liveChats.ts).
// 9.3 Phase C: also links to a "start a package" page for a live agent with no live subscription.
// 11.1c Phase C: upcoming, entitled live classes (see docs/tasks/11.1/plan.md "Phase C"). There is
// no repository method that lists a student's subscribed teachers directly, so (same as
// `homeChatLinks`/`homeStartLinks`) the candidates are the configured chat agents; each agent's
// owning teacher is resolved once, deduplicated, and `liveClasses.listUpcomingForStudent` is
// called per teacher scope. A failure here never blocks the chat/start links: it is caught here
// and logged, same shape as `homeChatLinks`.
import { studentScope, type StudentScope, type UpcomingLiveClass } from '@edmate/db';
import { requireRole, serverDatabase } from '../../src/auth';
import type { Principal } from '../../src/auth/guard';
import {
  chatAgentCandidates,
  homeChatLinks,
  homePausedLinks,
  homeStartLinks,
} from '../../src/chat/liveChats';
import { consoleLog } from '../../src/turn/runtime';
import { errorName, type ServerLog } from '../../src/turn/routes';
import type { AgentOwners } from '../../src/turn/scope';
import { HomeView } from './view';

export const dynamic = 'force-dynamic';

const log = consoleLog('[home]');

interface HomeLiveClassDeps {
  agents: AgentOwners;
  liveClasses: { listUpcomingForStudent(scope: StudentScope): Promise<UpcomingLiveClass[]> };
}

/** The scope's own upcoming, entitled live classes across every candidate's teacher. */
async function homeLiveClasses(
  open: () => HomeLiveClassDeps,
  principal: Principal,
  candidates: readonly string[],
  serverLog: ServerLog,
): Promise<UpcomingLiveClass[]> {
  if (candidates.length === 0) return [];
  try {
    const { agents, liveClasses } = open();
    const teacherIds = new Set<string>();
    for (const agentId of candidates) {
      const owner = await agents.owner({ agentId });
      if (owner !== null) teacherIds.add(owner.teacherId);
    }
    const lists = await Promise.all(
      [...teacherIds].map((teacherId) =>
        liveClasses.listUpcomingForStudent(
          studentScope({ studentId: principal.userId, teacherId }, 'homeLiveClasses'),
        ),
      ),
    );
    return lists.flat().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  } catch (error) {
    serverLog.error('home.live_classes_failed', { error: errorName(error) });
    return [];
  }
}

export default async function HomePage() {
  const principal = await requireRole(['student']);
  const candidates = chatAgentCandidates(process.env);
  const open = () => serverDatabase().repos;
  const chats = await homeChatLinks(open, principal, candidates, log);
  const startable = await homeStartLinks(open, principal, candidates, log);
  const paused = await homePausedLinks(open, principal, candidates, log);
  const liveClasses = await homeLiveClasses(open, principal, candidates, log);
  return <HomeView chats={chats} startable={startable} paused={paused} liveClasses={liveClasses} />;
}
