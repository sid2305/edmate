// Task 9.6 Phase B: the student's progress page body (a server component wraps this with the
// shell and translations, same pattern as `MemoryView`). Server-safe: it only reads props and
// translations, no client state, so no `'use client'` pragma.
import { useTranslations } from 'next-intl';
import type { Progress } from './progress';

export interface ProgressViewProps {
  agentId: string;
  progress: Progress;
}

export function ProgressView({ agentId, progress }: ProgressViewProps) {
  const t = useTranslations('progress');
  const exportJsonHref = `/api/me/export/${encodeURIComponent(agentId)}`;
  const exportPdfHref = `/api/me/export/${encodeURIComponent(agentId)}/notes`;
  const isEmpty = progress.modules.length === 0;

  return (
    <div>
      <p>
        {t('covered', { n: progress.counts.topicsCovered })}
        {' · '}
        {t('mastered', { n: progress.counts.topicsMastered })}
      </p>
      {isEmpty ? <p>{t('empty')}</p> : null}
      {progress.modules.map((m) => (
        <section key={m.id}>
          <h2>{m.title}</h2>
          <ul>
            {m.topics.map((topic) => (
              <li key={topic.id}>
                {topic.title}: {t(`state.${topic.state}`)}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h2>{t('nextStepsTitle')}</h2>
        {progress.nextSteps.length === 0 ? (
          <p>{t('nextStepsEmpty')}</p>
        ) : (
          <ul>
            {progress.nextSteps.map((step) => (
              <li key={step.id}>{step.title}</li>
            ))}
          </ul>
        )}
      </section>
      <p>
        <a href={exportJsonHref} download>
          {t('exportJsonLink')}
        </a>
      </p>
      <p>
        <a href={exportPdfHref} download>
          {t('exportPdfLink')}
        </a>
      </p>
    </div>
  );
}
