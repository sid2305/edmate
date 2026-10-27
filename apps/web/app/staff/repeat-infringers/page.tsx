// Task 12.3d: the repeat-infringer list (B-63). Staff only (`requireRole`, before any database
// read); the flagged list is read for the session's own staff id, through the same
// `listRepeatInfringersForStaff` helper `/api/staff/repeat-infringers` calls -- the page and the
// API can never drift from each other. A failed read renders the view's fallback (with a reload)
// and logs only the error's name. Reached only via the `/staff` banner (no new nav item), same as
// `/staff/alerts`.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole, serverDatabase } from '../../../src/auth';
import { describeError } from '../../../src/auth/describe-error';
import { AppShell } from '../../../src/ui/AppShell';
import { listRepeatInfringersForStaff } from '../../api/staff/repeat-infringers/handlers';
import { signOutAndRedirect } from '../../home/actions';
import { StaffRepeatInfringersView } from './view';

export const dynamic = 'force-dynamic';

export default async function StaffRepeatInfringersPage() {
  const principal = await requireRole(['staff']);
  let initial: unknown = null;
  try {
    initial = await listRepeatInfringersForStaff(serverDatabase().repos, principal.userId);
  } catch (error) {
    console.error(`[staff] repeat-infringers page read failed: ${describeError(error)}`);
  }
  const shell = await getTranslations('shell');
  const t = await getTranslations('staffRepeatInfringers');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/staff/repeat-infringers', label: t('title') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: both namespaces the reused <VerificationRow> and this page need. */}
      <NextIntlClientProvider
        locale="en"
        messages={{ staff: messages.staff, staffRepeatInfringers: messages.staffRepeatInfringers }}
      >
        <StaffRepeatInfringersView initial={initial} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
