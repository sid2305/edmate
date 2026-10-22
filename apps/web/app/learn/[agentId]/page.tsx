// Task 9.4 Phase C: the student chat page. The guard asks for consent done (`clearance: 'agent'`)
// before anything else; `loadChat` checks the agent is live and reopens `?s=` only when it is the
// student's own open session with this agent. The chat itself is the client `ChatView`.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import messages from '../../../messages/en.json';
import { requireRole, serverDatabase } from '../../../src/auth';
import { ChatView } from '../../../src/chat/ChatView';
import { loadChat } from '../../../src/chat/loadChat';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../../home/actions';
import '../../../src/chat/chat.css';

export const dynamic = 'force-dynamic';

export interface LearnPageProps {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LearnPage({ params, searchParams }: LearnPageProps) {
  const data = await loadChat(
    {
      requireStudent: () => requireRole(['student'], { clearance: 'agent' }),
      repos: () => serverDatabase().repos,
      notFound,
    },
    (await params).agentId,
    (await searchParams).s,
  );
  const shell = await getTranslations('shell');
  const home = await getTranslations('home');
  const chat = await getTranslations('chat');
  const memory = await getTranslations('memory');
  const progress = await getTranslations('progress');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[
        { href: '/home', label: home('nav') },
        // 6.5: the student's own view, export and reset of what the agent remembers.
        { href: `/learn/${encodeURIComponent(data.agentId)}/memory`, label: memory('navLink') },
        // 9.6: the progress page, with links to the complete JSON export and notes PDF.
        { href: `/learn/${encodeURIComponent(data.agentId)}/progress`, label: progress('navLink') },
      ]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{chat('title')}</h1>
      {/* English-only pilot: the chat's own strings go to the client, nothing else. */}
      <NextIntlClientProvider locale="en" messages={{ chat: messages.chat }}>
        <ChatView agentId={data.agentId} sessionId={data.sessionId} history={data.history} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
