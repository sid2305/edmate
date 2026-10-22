// Task 12.4d: the staff regulated-subject console. Staff only (`requireRole`, before any database
// read); the agent list is read for the session's own staff id (12.4a's `listForStaff`). A failed
// read renders the view's fallback (with a reload) and logs only the error's name. Reached by
// direct URL: staff accounts come only from `db:grant-role` today (12.1b's own note).
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole, serverDatabase } from '../../../src/auth';
import { describeError } from '../../../src/auth/describe-error';
import { AppShell } from '../../../src/ui/AppShell';
import { toAgentItem } from '../../api/staff/agents/handlers';
import { signOutAndRedirect } from '../../home/actions';
import { StaffAgentsView } from './view';

export const dynamic = 'force-dynamic';

export default async function StaffAgentsPage() {
  const principal = await requireRole(['staff']);
  let initial: unknown = null;
  try {
    const rows = await serverDatabase().repos.regulatedSubjects.listForStaff(principal.userId);
    initial = rows.map(toAgentItem);
  } catch (error) {
    console.error(`[staff] agents page read failed: ${describeError(error)}`);
  }
  const shell = await getTranslations('shell');
  const t = await getTranslations('staffAgents');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/staff/agents', label: t('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the staff agents console's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ staffAgents: messages.staffAgents }}>
        <StaffAgentsView initial={initial} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
