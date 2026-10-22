// Task 9.6 Phase D: the student's plan page. Clearance stays at the default `age` (not `agent`),
// the same precedent as the memory and progress pages: a student waiting on a parent's consent
// can still manage their own plan. The agent must still be live (`agents.owner`); a draft,
// suspended or missing one gives notFound. No payment yet, so every live offer of the agent is
// shown as an "other package" alongside the current one (9.6c Q1 = (a)).
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import messages from '../../../../messages/en.json';
import { HOME_PATH, requireRole, serverDatabase } from '../../../../src/auth';
import { StartSessionSchema } from '../../../../src/turn/clientInput';
import { PlanView, type PlanOffer, type PlanSubscription } from '../../../../src/subscriptions/PlanView';
import { AppShell } from '../../../../src/ui/AppShell';
import { signOutAndRedirect } from '../../../home/actions';

export const dynamic = 'force-dynamic';

const IdSchema = StartSessionSchema.shape.agentId;

export interface PlanPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function PlanPage({ params }: PlanPageProps) {
  const principal = await requireRole(['student']);
  const parsed = IdSchema.safeParse((await params).agentId);
  if (!parsed.success) return notFound();
  const agentId = parsed.data;
  const repos = serverDatabase().repos;
  const owner = await repos.agents.owner({ agentId });
  if (owner === null) return notFound();
  const scope = { studentId: principal.userId, teacherId: owner.teacherId };

  const [live, offers] = await Promise.all([
    repos.subscriptions.findLive(scope),
    repos.packageVersions.liveForAgent({ agentId }),
  ]);
  const planOffers: PlanOffer[] = offers.map((o) => ({
    packageId: o.offer.packageId,
    name: o.offer.name,
    amountMinor: o.offer.pricePerMonth.amountMinor,
    currency: o.offer.pricePerMonth.currency,
  }));
  let subscription: PlanSubscription | null = null;
  if (live !== null && live.status !== 'ended') {
    const current = await repos.packageVersions.getById({ teacherId: owner.teacherId }, live.packageVersionId);
    // Task 9.6i: fail closed like the PATCH route does, never showing the internal version id.
    if (current === null) return notFound();
    subscription = {
      id: live.id,
      status: live.status as PlanSubscription['status'],
      periodEnd: live.periodEnd,
      packageId: current.id,
    };
  }

  const shell = await getTranslations('shell');
  const home = await getTranslations('home');
  const t = await getTranslations('plan');

  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: HOME_PATH, label: home('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {/* English-only pilot: only the plan view's own strings go to the client. */}
      <NextIntlClientProvider locale="en" messages={{ plan: messages.plan }}>
        <PlanView agentId={agentId} subscription={subscription} offers={planOffers} />
      </NextIntlClientProvider>
    </AppShell>
  );
}
