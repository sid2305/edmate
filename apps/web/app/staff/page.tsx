// Task 12.1b: the staff verification console. Staff only (`requireRole`, before any database
// read); the queue is read for the session's own staff id (12.1a's `listPendingForStaff`). A
// failed read renders the view's fallback (with a reload) and logs only the error's name. Reached
// by direct URL: staff accounts come only from `db:grant-role` today (plan Q1).
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../messages/en.json';
import { requireRole, serverDatabase } from '../../src/auth';
import { describeError } from '../../src/auth/describe-error';
import { AppShell } from '../../src/ui/AppShell';
import { toQueueItem, type QueueItem } from '../api/staff/verifications/handlers';
import { signOutAndRedirect } from '../home/actions';
import { StaffQueueView } from './view';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const principal = await requireRole(['staff']);
  let initial: QueueItem[] | null = null;
  try {
    const rows = await serverDatabase().repos.teacherProfiles.listPendingForStaff(principal.userId);
    initial = rows.map(toQueueItem);
  } catch (error) {
    console.error(`[staff] page queue read failed: ${describeError(error)}`);
  }
  const shell = await getTranslations('shell');
  const t = await getTranslations('staff');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/staff', label: t('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the staff console's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ staff: messages.staff }}>
        <StaffQueueView initial={initial} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
