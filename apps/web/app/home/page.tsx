// Task 9.1 Phase C: the student home route. Thin -- `requireRole` gates it, `HomeView` is the
// actual markup (kept pure so it can be tested directly, no server-only guard to stub).
// 9.4: links to the chats of the student's live subscriptions (see src/chat/liveChats.ts).
// 9.3 Phase C: also links to a "start a package" page for a live agent with no live subscription.
import { requireRole, serverDatabase } from '../../src/auth';
import { chatAgentCandidates, homeChatLinks, homeStartLinks } from '../../src/chat/liveChats';
import { consoleLog } from '../../src/turn/runtime';
import { HomeView } from './view';

export const dynamic = 'force-dynamic';

const log = consoleLog('[home]');

export default async function HomePage() {
  const principal = await requireRole(['student']);
  const candidates = chatAgentCandidates(process.env);
  const open = () => serverDatabase().repos;
  const chats = await homeChatLinks(open, principal, candidates, log);
  const startable = await homeStartLinks(open, principal, candidates, log);
  return <HomeView chats={chats} startable={startable} />;
}
