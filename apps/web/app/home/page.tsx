// Task 9.1 Phase C: the student home route. Thin -- `requireRole` gates it, `HomeView` is the
// actual markup (kept pure so it can be tested directly, no server-only guard to stub).
// 9.4: links to the chats of the student's live subscriptions (see src/chat/liveChats.ts).
// 9.3 Phase C: also links to a "start a package" page for a live agent with no live subscription.
// 11.1c Phase C: upcoming, entitled live classes (see docs/tasks/11.1/plan.md "Phase C"). There is
// no repository method that lists a student's subscribed teachers directly, so the candidates are
// the configured chat agents; `homeLinks` (src/chat/liveChats.ts) resolves each one's owning
// teacher exactly once and returns the deduplicated list, which this page reuses here instead of
// its own `agents.owner` pass. A failure here never blocks the chat/start/paused links: it is
// caught here and logged, same shape as `homeLinks`.
// 9.3b (9.3/9.6e review follow-up, MEDIUM): the chat/start/paused/live-classes loaders used to run
// one after another, each re-querying `agents.owner`/`subscriptions.findLive`. `homeLinks` now
// does that scan once, and the two independent loaders left (`homeLinks` and `homeLiveClasses`,
// which only needs `homeLinks`' own teacher ids) run concurrently via `Promise.all`.
import { studentScope, type StudentScope, type UpcomingLiveClass } from '@edmate/db';
import { requireRole, serverDatabase } from '../../src/auth';
import type { Principal } from '../../src/auth/guard';
import { chatAgentCandidates, homeLinks } from '../../src/chat/liveChats';
import { consoleLog } from '../../src/turn/runtime';
import { errorName, type ServerLog } from '../../src/turn/routes';
import { HomeView } from './view';

export const dynamic = 'force-dynamic';

const log = consoleLog('[home]');

interface HomeLiveClassDeps {
  liveClasses: { listUpcomingForStudent(scope: StudentScope): Promise<UpcomingLiveClass[]> };
}

/** The scope's own upcoming, entitled live classes across every given teacher. */
async function homeLiveClasses(
  open: () => HomeLiveClassDeps,
  principal: Principal,
  teacherIds: readonly string[],
  serverLog: ServerLog,
): Promise<UpcomingLiveClass[]> {
  if (teacherIds.length === 0) return [];
  try {
    const { liveClasses } = open();
    const lists = await Promise.all(
      teacherIds.map((teacherId) =>
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
  const { chats, startable, paused, teacherIds } = await homeLinks(open, principal, candidates, log);
  const liveClasses = await homeLiveClasses(open, principal, teacherIds, log);
  return <HomeView chats={chats} startable={startable} paused={paused} liveClasses={liveClasses} />;
}
