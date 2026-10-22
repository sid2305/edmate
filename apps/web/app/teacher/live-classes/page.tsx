// Task 11.1b Phase B: the teacher's live classes studio (task 11.1). Teachers only (`requireRole`);
// the guard runs before any database read, and the classes/packages are read in the signed-in
// teacher's own scope (never a request field) by `loadLiveClasses`. No nav link exists elsewhere
// yet, so this page is reachable by direct URL (same precedent as 8.5/8.9/9.3 -- plan "How it will
// be shown" step 1); do not edit `apps/web/app/teacher/view.tsx`.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole, serverDatabase } from '../../../src/auth';
import { loadLiveClasses } from '../../../src/studio/liveClasses/loadLiveClasses';
import { LiveClassesView } from './LiveClassesView';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../actions';

export const dynamic = 'force-dynamic';

export default async function LiveClassesPage() {
  const data = await loadLiveClasses({
    requireTeacher: () => requireRole(['teacher']),
    repos: () => serverDatabase().repos,
  });
  const shell = await getTranslations('shell');
  const teacher = await getTranslations('teacher');
  const t = await getTranslations('liveClassesStudio');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/teacher', label: teacher('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the live-classes studio's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ liveClassesStudio: messages.liveClassesStudio }}>
        <LiveClassesView classes={data.classes} packages={data.packages} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
