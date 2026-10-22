// Task 9.1 Phase C: a role-gated placeholder for 8.1 to extend or replace (e.g.
// `app/teacher/onboarding/**`), reusing `AppShell`. Pure (no `requireRole`), so `view.test.tsx`
// renders it directly.
import { getTranslations } from 'next-intl/server';
import { AppShell } from '../../src/ui/AppShell';
import { signOutAndRedirect } from './actions';

export async function TeacherView() {
  const shell = await getTranslations('shell');
  const t = await getTranslations('teacher');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[
        { href: '/teacher', label: t('nav') },
        { href: '/teacher/uploads', label: t('uploadsLink') },
        { href: '/teacher/outline', label: t('outlineLink') },
        { href: '/teacher/onboarding', label: t('onboardingLink') },
        { href: '/teacher/style-card', label: t('styleCardLink') },
        { href: '/teacher/packages', label: t('packagesLink') },
      ]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      <p>{t('placeholder')}</p>
    </AppShell>
  );
}
