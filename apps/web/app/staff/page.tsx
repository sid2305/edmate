// Task 12.1b: the staff verification console. Staff only (`requireRole`, before any database
// read); the queue is read for the session's own staff id (12.1a's `listPendingForStaff`). A
// failed read renders the view's fallback (with a reload) and logs only the error's name. Reached
// by direct URL: staff accounts come only from `db:grant-role` today (plan Q1).
//
// Task 12.5c: a small banner with the open and escalated safety-alert counts, linking to
// `/staff/alerts`. A failed count read just hides the banner (logging only the error's name): it
// never blocks the verification queue.
import { SAFETY_ALERT_LIST_MAX_LIMIT } from '@edmate/db';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../messages/en.json';
import { requireRole, serverDatabase } from '../../src/auth';
import { describeError } from '../../src/auth/describe-error';
import { AppShell } from '../../src/ui/AppShell';
import { toAlertView } from '../api/staff/alerts/handlers';
import { enrichQueueRows, toQueueItem, type QueueItem } from '../api/staff/verifications/handlers';
import { signOutAndRedirect } from '../home/actions';
import { StaffQueueView } from './view';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const principal = await requireRole(['staff']);
  let initial: QueueItem[] | null = null;
  try {
    const repos = serverDatabase().repos;
    const rows = await repos.teacherProfiles.listPendingForStaff(principal.userId);
    const enriched = await enrichQueueRows(repos, principal.userId, rows);
    initial = enriched.map((r) => toQueueItem(r, r.activeTakedowns, r.lastDecision));
  } catch (error) {
    console.error(`[staff] page queue read failed: ${describeError(error)}`);
  }
  let alertBanner: { open: number; escalated: number } | null = null;
  try {
    const rows = await serverDatabase().repos.safetyAlerts.listForStaff(principal.userId, {
      status: 'open',
      limit: SAFETY_ALERT_LIST_MAX_LIMIT,
    });
    const views = rows.map((r) => toAlertView(r, Date.now()));
    alertBanner = {
      open: views.length,
      escalated: views.filter((a) => a.escalatedAt !== null || a.overdue).length,
    };
  } catch (error) {
    console.error(`[staff] page alert count read failed: ${describeError(error)}`);
  }
  const shell = await getTranslations('shell');
  const t = await getTranslations('staff');
  const staffAgents = await getTranslations('staffAgents');
  const staffReports = await getTranslations('staffReports');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[
        { href: '/staff', label: t('nav') },
        { href: '/staff/agents', label: staffAgents('nav') },
        { href: '/staff/reports', label: staffReports('nav') },
      ]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {alertBanner === null || alertBanner.open === 0 ? null : (
        <p className="staff-alerts-banner">
          <a href="/staff/alerts">
            {t('alertsBanner', { open: alertBanner.open, escalated: alertBanner.escalated })}
          </a>
        </p>
      )}
      {/* English-only pilot: only the staff console's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ staff: messages.staff }}>
        <StaffQueueView initial={initial} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
