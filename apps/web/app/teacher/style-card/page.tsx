// Task 8.4b: the teacher's style card studio. Teachers only (`requireRole`); the current card is
// always the session's own teacher's, read for first paint, never a request field.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole, serverDatabase, TEACHER_PATH } from '../../../src/auth';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../actions';
import { StyleCardView } from './StyleCardView';
import './style-card.css';

export const dynamic = 'force-dynamic';

export default async function StyleCardPage() {
  const principal = await requireRole(['teacher']);
  const card = await serverDatabase().repos.styleCards.latest({ teacherId: principal.userId });
  const shell = await getTranslations('shell');
  const teacher = await getTranslations('teacher');
  const t = await getTranslations('styleCard');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[
        { href: TEACHER_PATH, label: teacher('nav') },
        { href: '/teacher/uploads', label: teacher('uploadsLink') },
        { href: '/teacher/onboarding', label: teacher('onboardingLink') },
        { href: '/teacher/style-card', label: teacher('styleCardLink') },
      ]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the style card's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ styleCard: messages.styleCard }}>
        <StyleCardView initialCard={card} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
