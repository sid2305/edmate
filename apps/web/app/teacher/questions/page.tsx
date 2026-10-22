// Task 8.9 Phase C: the teacher's questions inbox. Teachers only (`requireRole`); the guard runs
// before any database read, and the groups/modules are read in the signed-in teacher's own scope
// (never a request field) by `loadQuestions`. No nav link exists elsewhere yet, so this page is
// reachable by direct URL (same precedent as 8.5/9.3 -- plan Q5); the view.tsx nav link lands in
// this same phase.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole, serverDatabase } from '../../../src/auth';
import { loadQuestions } from '../../../src/studio/questions/loadQuestions';
import { QuestionsInboxView } from '../../../src/studio/questions/QuestionsInboxView';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../actions';

export const dynamic = 'force-dynamic';

export default async function QuestionsPage() {
  const data = await loadQuestions({
    requireTeacher: () => requireRole(['teacher']),
    repos: () => serverDatabase().repos,
  });
  const shell = await getTranslations('shell');
  const teacher = await getTranslations('teacher');
  const t = await getTranslations('questionsInbox');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[
        { href: '/teacher', label: teacher('nav') },
        { href: '/teacher/questions', label: teacher('questionsLink') },
      ]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the questions inbox's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ questionsInbox: messages.questionsInbox }}>
        <QuestionsInboxView groups={data.groups} modules={data.modules} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
