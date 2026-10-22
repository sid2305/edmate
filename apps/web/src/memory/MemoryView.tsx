// Task 6.5 Phase B: the student's memory page body (a server component wraps this with the shell
// and translations). Topics show as their ids -- a topics read for titles is deferred (plan Q3/the
// "Deferred" list). `profile === null` (no row yet) and an empty profile both show the empty state.
import type { LearnerProfile } from '@edmate/contracts';
import { useTranslations } from 'next-intl';
import { ResetMemoryButton } from './ResetMemoryButton';

export interface MemoryViewProps {
  agentId: string;
  profile: LearnerProfile | null;
}

function masteryPercent(p: number): number {
  return Math.round(p * 100);
}

export function MemoryView({ agentId, profile }: MemoryViewProps) {
  const t = useTranslations('memory');
  const mastery = profile ? Object.entries(profile.mastery) : [];
  const mistakes = profile?.mistakes ?? [];
  const summary = profile?.lastSummary;
  const isEmpty = mastery.length === 0 && mistakes.length === 0 && !summary;
  const exportHref = `/api/me/memory/${encodeURIComponent(agentId)}`;

  return (
    <div>
      {isEmpty ? <p>{t('empty')}</p> : null}
      {mastery.length > 0 ? (
        <section>
          <h2>{t('masteryTitle')}</h2>
          <ul>
            {mastery.map(([topicId, m]) => (
              <li key={topicId}>
                {topicId}: {masteryPercent(m.p)}% ({t('masteryEvidence', { n: m.n })})
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {mistakes.length > 0 ? (
        <section>
          <h2>{t('mistakesTitle')}</h2>
          <ul>
            {mistakes.map((m) => (
              <li key={m.tag}>
                {m.tag}: {t('mistakeCount', { count: m.count })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {summary ? (
        <section>
          <h2>{t('summaryTitle')}</h2>
          <p>{summary}</p>
        </section>
      ) : null}
      <p>
        <a href={exportHref} download>
          {t('exportLink')}
        </a>
      </p>
      <ResetMemoryButton agentId={agentId} />
    </div>
  );
}
