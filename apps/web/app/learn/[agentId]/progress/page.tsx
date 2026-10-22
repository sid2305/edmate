// Task 9.6 Phase B: the student's progress page. Clearance stays at the default `age` (not
// `agent`), the same precedent as the memory page: a student waiting on a parent's consent can
// still see their own progress and download both exports. The agent must still be live
// (`agents.owner`); a draft, suspended or missing one gives notFound.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import messages from '../../../../messages/en.json';
import { HOME_PATH, requireRole, serverDatabase } from '../../../../src/auth';
import { StartSessionSchema } from '../../../../src/turn/clientInput';
import { buildProgress } from '../../../../src/progress/progress';
import { ProgressView } from '../../../../src/progress/ProgressView';
import { AppShell } from '../../../../src/ui/AppShell';
import { signOutAndRedirect } from '../../../home/actions';

export const dynamic = 'force-dynamic';

const IdSchema = StartSessionSchema.shape.agentId;

export interface ProgressPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function ProgressPage({ params }: ProgressPageProps) {
  const principal = await requireRole(['student']);
  const parsed = IdSchema.safeParse((await params).agentId);
  if (!parsed.success) return notFound();
  const agentId = parsed.data;
  const repos = serverDatabase().repos;
  const owner = await repos.agents.owner({ agentId });
  if (owner === null) return notFound();
  const scope = { studentId: principal.userId, teacherId: owner.teacherId };

  const [profile, outline, subscription] = await Promise.all([
    repos.learnerProfiles.get(scope),
    repos.outline.getOutline({ teacherId: owner.teacherId }),
    repos.subscriptions.findLive(scope),
  ]);
  const packageConfig = subscription
    ? await repos.packageVersions.getById({ teacherId: owner.teacherId }, subscription.packageVersionId)
    : null;
  const progress = buildProgress({ outline, profile, allowedModuleIds: packageConfig?.moduleIds ?? [] });

  const shell = await getTranslations('shell');
  const home = await getTranslations('home');
  const t = await getTranslations('progress');

  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: HOME_PATH, label: home('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the progress view's own strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ progress: messages.progress }}>
        <ProgressView agentId={agentId} progress={progress} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
