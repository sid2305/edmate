// Task 9.4 Phase C: the topic is outside the student's package.
import { useTranslations } from 'next-intl';

export function LockedNotice({ packageName }: { packageName?: string }) {
  const t = useTranslations('chat');
  return (
    <p className="chat-notice">
      {packageName === undefined ? t('lockedGeneric') : t('locked', { packageName })}
    </p>
  );
}
