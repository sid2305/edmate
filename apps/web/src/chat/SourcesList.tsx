// Task 9.4 Phase C: the reply's sources, title and locator as plain text (never links).
import type { SourceRef } from '@edmate/contracts';
import { useTranslations } from 'next-intl';

export function SourcesList({ items }: { items: readonly SourceRef[] }) {
  const t = useTranslations('chat');
  if (items.length === 0) return null;
  return (
    <div className="chat-sources">
      <p className="chat-sources-title">{t('sources')}</p>
      <ul>
        {items.map((s, i) => (
          <li key={i}>
            {s.title} · {s.locator}
          </li>
        ))}
      </ul>
    </div>
  );
}
