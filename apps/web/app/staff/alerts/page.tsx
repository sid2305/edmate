// Task 12.5c: the staff alert inbox. Staff only (`requireRole`, before any database read); the
// open list is read for the session's own staff id (12.5a's `listForStaff`), with `overdue`
// computed the same way the API does. A failed read renders the view's fallback (with a reload)
// and logs only the error's name. Reached by direct URL: staff accounts come only from
// `db:grant-role` today (12.1b's own note).
import { SAFETY_ALERT_LIST_MAX_LIMIT } from '@edmate/db';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole, serverDatabase } from '../../../src/auth';
import { describeError } from '../../../src/auth/describe-error';
import { AppShell } from '../../../src/ui/AppShell';
import { toAlertView } from '../../api/staff/alerts/handlers';
import { signOutAndRedirect } from '../../home/actions';
import { StaffAlertView } from './view';

export const dynamic = 'force-dynamic';

export default async function StaffAlertsPage() {
  const principal = await requireRole(['staff']);
  let initial: unknown = null;
  try {
    const rows = await serverDatabase().repos.safetyAlerts.listForStaff(principal.userId, {
      status: 'open',
      limit: SAFETY_ALERT_LIST_MAX_LIMIT,
    });
    initial = rows.map((r) => toAlertView(r, Date.now()));
  } catch (error) {
    console.error(`[staff] alerts page read failed: ${describeError(error)}`);
  }
  const shell = await getTranslations('shell');
  const t = await getTranslations('staffAlerts');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/staff/alerts', label: t('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the staff alert inbox's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ staffAlerts: messages.staffAlerts }}>
        <StaffAlertView initial={initial} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
