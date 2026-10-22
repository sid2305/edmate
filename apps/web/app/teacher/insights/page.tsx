// Task 8.8 Phase B: the teacher's insights page. Teachers only (`requireRole`); every read is
// scoped to the session's own teacher, never a request field. Server component only -- no client
// JS, no fetch -- so there is no "trusts a 200 response" risk here (see docs/lessons.md): the
// data comes from a direct server-side call to `loadInsights`, not a route handler.
import { getTranslations } from 'next-intl/server';
import { requireRole, serverDatabase } from '../../../src/auth';
import { loadInsights, type InsightsQuestionGroup } from '../../../src/studio/insights';
import { AppShell } from '../../../src/ui/AppShell';
import { signOutAndRedirect } from '../actions';

export const dynamic = 'force-dynamic';

/** `oldestAt` is an ISO timestamp; shown as a plain date (English-only pilot, no locale lookup). */
function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function formatMs(stats: { p50: number; p95: number } | undefined): string | undefined {
  if (stats === undefined) return undefined;
  return `${stats.p50}ms / ${stats.p95}ms`;
}

export default async function InsightsPage() {
  const principal = await requireRole(['teacher']);
  const insights = await loadInsights(serverDatabase().repos, { teacherId: principal.userId });
  const shell = await getTranslations('shell');
  const teacher = await getTranslations('teacher');
  const t = await getTranslations('insights');

  const { health } = insights;
  const replyLatency = formatMs(health.stepLatencyMs.generate);
  const firstTokenLatency = formatMs(health.stepLatencyMs.firstToken);

  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[
        { href: '/teacher', label: teacher('nav') },
        { href: '/teacher/uploads', label: teacher('uploadsLink') },
        { href: '/teacher/insights', label: teacher('insightsLink') },
      ]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>

      <section aria-labelledby="insights-health-title">
        <h2 id="insights-health-title">{t('healthTitle')}</h2>
        {health.turns === 0 ? (
          <p>{t('healthEmpty')}</p>
        ) : (
          <>
            {insights.capped && <p role="status">{t('cappedNotice')}</p>}
            <dl>
              <dt>{t('turnsLabel')}</dt>
              <dd>{health.turns}</dd>
              <dt>{t('errorRateLabel')}</dt>
              <dd>{Math.round(health.errorRate * 100)}%</dd>
              <dt>{t('guardRateLabel')}</dt>
              <dd>{Math.round(health.guardRate * 100)}%</dd>
              {replyLatency !== undefined && (
                <>
                  <dt>{t('replyLatencyLabel')}</dt>
                  <dd>{replyLatency}</dd>
                </>
              )}
              {firstTokenLatency !== undefined && (
                <>
                  <dt>{t('firstTokenLabel')}</dt>
                  <dd>{firstTokenLatency}</dd>
                </>
              )}
            </dl>
          </>
        )}
      </section>

      <section aria-labelledby="insights-questions-title">
        <h2 id="insights-questions-title">{t('questionsTitle')}</h2>
        {insights.topQuestionGroups.length === 0 ? (
          <p>{t('questionsEmpty')}</p>
        ) : (
          <ul>
            {insights.topQuestionGroups.map((g: InsightsQuestionGroup) => (
              <li key={g.groupId}>
                <p>{t('questionsSince', { count: g.count, date: formatDate(g.oldestAt) })}</p>
                <p>{g.sample}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
