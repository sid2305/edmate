// Task 8.3 Phase C: the teacher's outline editor page. Teachers only (`requireRole`); the outline
// itself is fetched and edited client-side by `OutlineView` over `GET`/`PUT /api/studio/outline`
// and `POST /api/studio/outline/generate` (8.3 Phase B) -- the teacher is always the session's
// own principal there, so this page reads nothing from the database directly.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole } from '../../../src/auth';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../actions';
import { OutlineView } from './OutlineView';

export const dynamic = 'force-dynamic';

export default async function OutlinePage() {
  await requireRole(['teacher']);
  const shell = await getTranslations('shell');
  const teacher = await getTranslations('teacher');
  const t = await getTranslations('outline');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[
        { href: '/teacher', label: teacher('nav') },
        { href: '/teacher/uploads', label: teacher('uploadsLink') },
        { href: '/teacher/outline', label: teacher('outlineLink') },
      ]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the outline editor's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ outline: messages.outline }}>
        <OutlineView />
      </NextIntlClientProvider>
    </AppShell>
  );
}
