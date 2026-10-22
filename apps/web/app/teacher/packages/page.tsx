// Task 8.6 Phase D: the teacher's package builder. Teachers only (`requireRole`); the page itself
// reads nothing from the database -- the client component fetches everything it needs (packages,
// modules, setup, the per-turn cost) from `GET /api/studio/packages`, same pattern as the uploads
// page's client-side list.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole, TEACHER_PATH } from '../../../src/auth';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../actions';
import { PackagesView } from './PackagesView';

export const dynamic = 'force-dynamic';

export default async function PackagesPage() {
  await requireRole(['teacher']);
  const shell = await getTranslations('shell');
  const teacher = await getTranslations('teacher');
  const t = await getTranslations('packageBuilder');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[
        { href: TEACHER_PATH, label: teacher('nav') },
        { href: '/teacher/uploads', label: teacher('uploadsLink') },
        { href: '/teacher/onboarding', label: teacher('onboardingLink') },
        { href: '/teacher/style-card', label: teacher('styleCardLink') },
        { href: '/teacher/packages', label: teacher('packagesLink') },
      ]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the package builder's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ packageBuilder: messages.packageBuilder }}>
        <PackagesView />
      </NextIntlClientProvider>
    </AppShell>
  );
}
