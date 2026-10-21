// Task 8.2 Phase 4: the teacher's upload centre. Teachers only (`requireRole`; clearance is a
// student standing, so a teacher always meets it). The server reads only the teacher's module ids;
// the file list itself is fetched and polled by the client `UploadsView`.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import messages from '../../../messages/en.json';
import { requireRole, serverDatabase } from '../../../src/auth';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../actions';
import { UploadsView } from './UploadsView';
import './uploads.css';

export const dynamic = 'force-dynamic';

export default async function UploadsPage() {
  const principal = await requireRole(['teacher']);
  const moduleIds = await serverDatabase().repos.modules.ids({ teacherId: principal.userId });
  const shell = await getTranslations('shell');
  const teacher = await getTranslations('teacher');
  const t = await getTranslations('uploads');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[
        { href: '/teacher', label: teacher('nav') },
        { href: '/teacher/uploads', label: teacher('uploadsLink') },
      ]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the upload centre's strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ uploads: messages.uploads }}>
        <UploadsView moduleIds={moduleIds} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
