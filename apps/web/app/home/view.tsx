// Task 9.1 Phase C: the student home view -- pure (no `requireRole`, so `view.test.tsx` renders
// it directly). 9.4 (chat) fills in the placeholder below.
import { getTranslations } from 'next-intl/server';
import { AppShell } from '../../src/ui/AppShell';
import { signOutAndRedirect } from './actions';

export async function HomeView() {
  const shell = await getTranslations('shell');
  const t = await getTranslations('home');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/home', label: t('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      <p>{t('placeholder')}</p>
    </AppShell>
  );
}
