// Task 8.1a: the onboarding page -- a signed-in teacher creates or edits their own profile.
// Teachers only (`requireRole`); the profile read is always the session's own teacher, never a
// request field.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole, serverDatabase } from '../../../src/auth';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../actions';
import { OnboardingForm } from './OnboardingForm';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const principal = await requireRole(['teacher']);
  const profile = await serverDatabase().repos.teacherProfiles.get({
    teacherId: principal.userId,
  });
  const shell = await getTranslations('shell');
  const teacher = await getTranslations('teacher');
  const t = await getTranslations('onboarding');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/teacher', label: teacher('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the onboarding form's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages.onboarding }}>
        <OnboardingForm initialProfile={profile} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
