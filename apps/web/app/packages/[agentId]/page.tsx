// Task 9.3 Phase B: the student's compare-and-start page for a live agent's live packages.
// Reachable by typed URL (no discovery link yet -- the same shape `/learn/[agentId]` had before
// 9.2). A student who already has a live subscription with this teacher skips the compare UI --
// upgrading/downgrading is 9.6, out of scope here.
import type { PackageOffer } from '@edmate/db';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import messages from '../../../messages/en.json';
import { requireRole, serverDatabase } from '../../../src/auth';
import { AppShell } from '../../../src/ui/AppShell';
import { StartSessionSchema } from '../../../src/turn/clientInput';
import { signOutAndRedirect } from '../../home/actions';
import { PackageCompare } from './PackageCompare';

export const dynamic = 'force-dynamic';

const IdSchema = StartSessionSchema.shape.agentId;

export interface PackagesPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function PackagesPage({ params }: PackagesPageProps) {
  const principal = await requireRole(['student'], { clearance: 'agent' });
  const parsed = IdSchema.safeParse((await params).agentId);
  if (!parsed.success) return notFound();
  const agentId = parsed.data;
  const repos = serverDatabase().repos;
  const owner = await repos.agents.owner({ agentId });
  if (owner === null) return notFound();
  const scope = { studentId: principal.userId, teacherId: owner.teacherId };
  const live = await repos.subscriptions.findLive(scope);
  const shell = await getTranslations('shell');
  const home = await getTranslations('home');
  const t = await getTranslations('packages');

  if (live !== null) {
    return (
      <AppShell
        brand={shell('brand')}
        skipLabel={shell('skipToContent')}
        nav={[{ href: '/home', label: home('nav') }]}
        signOutAction={signOutAndRedirect}
        signOutLabel={shell('signOut')}
      >
        <h1>{t('title')}</h1>
        <p>{t('alreadySubscribed')}</p>
        <a className="button" href={`/learn/${encodeURIComponent(agentId)}`}>
          {t('continueToChat')}
        </a>
      </AppShell>
    );
  }

  // Only the public offer crosses to the client component: never the teacher's internal config,
  // and not even the packageVersionId (the start route resolves it server-side).
  const packages: PackageOffer[] = (await repos.packageVersions.liveForAgent({ agentId })).map(
    (p) => p.offer,
  );
  // Task 9.3c: a teacher rejected after publishing has no live packages (liveForAgent's
  // verified join), so typing their agent's URL is indistinguishable from an unknown agent --
  // never an empty compare view.
  if (packages.length === 0) return notFound();
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/home', label: home('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the compare view's own strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ packages: messages.packages }}>
        <PackageCompare agentId={agentId} packages={packages} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
