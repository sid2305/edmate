// Task 8.7 Phase D: the teacher's publish page. Teachers only (`requireRole`); the page itself
// reads nothing from the database -- the client component fetches the latest gate run from
// `GET /api/studio/publish` and starts a publish with `POST` (same pattern as the packages page).
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole, TEACHER_PATH } from '../../../src/auth';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../actions';
import { PublishView } from './PublishView';

export const dynamic = 'force-dynamic';

export default async function PublishPage() {
  await requireRole(['teacher']);
  const shell = await getTranslations('shell');
  const teacher = await getTranslations('teacher');
  const t = await getTranslations('publish');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[
        { href: TEACHER_PATH, label: teacher('nav') },
        { href: '/teacher/packages', label: teacher('packagesLink') },
        { href: '/teacher/publish', label: t('navLink') },
      ]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the publish page's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ publish: messages.publish }}>
        <PublishView />
      </NextIntlClientProvider>
    </AppShell>
  );
}
