// Task 6.5 Phase B: the student's memory page. Clearance stays at the default `age` (not
// `agent`): a student waiting on a parent's consent can still see, export and reset their own
// data. The agent must still be live and have this student's own scope (notFound otherwise).
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import messages from '../../../../messages/en.json';
import { HOME_PATH, requireRole, serverDatabase } from '../../../../src/auth';
import { StartSessionSchema } from '../../../../src/turn/clientInput';
import { MemoryView } from '../../../../src/memory/MemoryView';
import { AppShell } from '../../../../src/ui/AppShell';
import { signOutAndRedirect } from '../../../home/actions';

export const dynamic = 'force-dynamic';

const IdSchema = StartSessionSchema.shape.agentId;

export interface MemoryPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function MemoryPage({ params }: MemoryPageProps) {
  const principal = await requireRole(['student']);
  const parsed = IdSchema.safeParse((await params).agentId);
  if (!parsed.success) return notFound();
  const agentId = parsed.data;
  const repos = serverDatabase().repos;
  const owner = await repos.agents.owner({ agentId });
  if (owner === null) return notFound();
  const scope = { studentId: principal.userId, teacherId: owner.teacherId };
  const profile = await repos.learnerProfiles.get(scope);
  const shell = await getTranslations('shell');
  const home = await getTranslations('home');
  const t = await getTranslations('memory');

  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: HOME_PATH, label: home('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the memory view's own strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ memory: messages.memory }}>
        <MemoryView agentId={agentId} profile={profile} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
