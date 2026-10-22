// Task 8.5 Phase C: the teacher's test chat for one agent, reachable by direct URL until 8.3/8.6
// add a link (plan open question 1). Teachers only (`requireRole`; clearance is a student
// standing, so a teacher always meets it). `loadTestChat` checks the agent is the teacher's own
// (drafts too) and reads its packages and the teacher's modules; the chat itself is the client
// `TestChatView`. An agent with no package to test shows a plain message, no dead link.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import messages from '../../../../messages/en.json';
import { requireRole, serverDatabase, TEACHER_PATH } from '../../../../src/auth';
import { loadTestChat } from '../../../../src/studio/testChat/loadTestChat';
import { TestChatView } from '../../../../src/studio/testChat/TestChatView';
import { AppShell } from '../../../../src/ui/AppShell';
import { signOutAndRedirect } from '../../actions';
import '../../../../src/chat/chat.css';

export const dynamic = 'force-dynamic';

export interface TestChatPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function TestChatPage({ params }: TestChatPageProps) {
  const data = await loadTestChat(
    {
      requireTeacher: () => requireRole(['teacher']),
      repos: () => serverDatabase().repos,
      notFound,
    },
    (await params).agentId,
  );
  const shell = await getTranslations('shell');
  const teacher = await getTranslations('teacher');
  const t = await getTranslations('testChat');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: TEACHER_PATH, label: teacher('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {data.packages.length === 0 ? (
        <p className="chat-empty">{t('noPackages')}</p>
      ) : (
        <>
          <p>{t('intro')}</p>
          {/* English-only pilot: only the chat's and the test chat's strings go to the client. */}
          <NextIntlClientProvider locale="en" messages={{ chat: messages.chat, testChat: messages.testChat }}>
            <TestChatView agentId={data.agentId} packages={data.packages} modules={data.modules} />
          </NextIntlClientProvider>
        </>
      )}
    </AppShell>
  );
}
