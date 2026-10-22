// Task 12.2e: the staff reports and takedowns console. Staff only (`requireRole`, before any
// database read); the queue and the active-takedowns list are read for the session's own staff id
// (12.2a's `listOpenForStaff`, 12.2b's `listActiveForStaff`). A failed read renders the view's
// fallback (with a reload) and logs only the error's name. Reached by direct URL: staff accounts
// come only from `db:grant-role` today (12.1b's own note).
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole, serverDatabase } from '../../../src/auth';
import { describeError } from '../../../src/auth/describe-error';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../../home/actions';
import { StaffReportsView } from './view';

export const dynamic = 'force-dynamic';

export default async function StaffReportsPage() {
  const principal = await requireRole(['staff']);
  let initialReports: unknown = null;
  try {
    initialReports = await serverDatabase().repos.reports.listOpenForStaff(principal.userId);
  } catch (error) {
    console.error(`[staff] reports page queue read failed: ${describeError(error)}`);
  }
  let initialTakedowns: unknown = null;
  try {
    initialTakedowns = await serverDatabase().repos.takedowns.listActiveForStaff(principal.userId);
  } catch (error) {
    console.error(`[staff] reports page takedowns read failed: ${describeError(error)}`);
  }
  const shell = await getTranslations('shell');
  const t = await getTranslations('staffReports');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/staff/reports', label: t('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the staff reports console's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ staffReports: messages.staffReports }}>
        <StaffReportsView initialReports={initialReports} initialTakedowns={initialTakedowns} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
