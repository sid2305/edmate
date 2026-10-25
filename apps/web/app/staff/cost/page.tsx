// Task 13.5 Phase B: the staff cost dashboard. Staff only (`requireRole`, before any database
// read); the default 30-day window is read server-side (same join the API route uses --
// `loadCostRows`, shared in `../../api/staff/cost/handlers`). A failed read renders the view's
// fallback (with a reload) and logs only the error's name.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { defaultWindow, loadCostRows } from '../../api/staff/cost/handlers';
import { requireRole, serverDatabase } from '../../../src/auth';
import { describeError } from '../../../src/auth/describe-error';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../../home/actions';
import { StaffCostView } from './view';

export const dynamic = 'force-dynamic';

export default async function StaffCostPage() {
  await requireRole(['staff']);
  const window = defaultWindow(Date.now());
  let initialRows: unknown = null;
  try {
    initialRows = await loadCostRows(serverDatabase().repos, window);
  } catch (error) {
    console.error(`[staff] cost page read failed: ${describeError(error)}`);
  }
  const shell = await getTranslations('shell');
  const t = await getTranslations('staffCost');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/staff/cost', label: t('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the staff cost dashboard's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ staffCost: messages.staffCost }}>
        <StaffCostView initialRows={initialRows} initialSince={window.since} initialUntil={window.until} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
