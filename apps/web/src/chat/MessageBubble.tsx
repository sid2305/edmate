// Task 9.4 Phase C: one message in the chat. Agent and teacher text goes through `renderReply`
// (React text nodes only); a student's own text is plain text. A provisional reply (still
// streaming, not yet checked) is muted, `aria-busy` and labelled "Still checking"; a reply that a
// `replace` corrected after it was shown carries a visible "Updated" marker.
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { renderReply } from './renderReply';

export type MessageRole = 'student' | 'agent' | 'teacher';

export interface MessageBubbleProps {
  role: MessageRole;
  text: string;
  provisional?: boolean;
  replaced?: boolean;
  /** Notices, cards and sources shown under the text. */
  children?: ReactNode;
}

const WHO = { student: 'you', agent: 'agent', teacher: 'teacher' } as const;

export function MessageBubble({ role, text, provisional = false, replaced = false, children }: MessageBubbleProps) {
  const t = useTranslations('chat');
  const classes = ['bubble', `bubble-${role}`, ...(provisional ? ['bubble-provisional'] : [])];
  return (
    <div className={classes.join(' ')} {...(provisional ? { 'aria-busy': 'true' as const } : {})}>
      <div className="bubble-meta">
        <span className="bubble-who">{t(WHO[role])}</span>
        {provisional ? <span className="bubble-status">{t('stillChecking')}</span> : null}
        {replaced ? (
          <span className="bubble-updated" title={t('updatedHint')}>
            {t('updated')}
            <span className="visually-hidden">{t('updatedHint')}</span>
          </span>
        ) : null}
      </div>
      {role === 'student' ? (
        <p className="bubble-text">{text}</p>
      ) : text === '' ? null : (
        <div className="bubble-text">{renderReply(text)}</div>
      )}
      {children}
    </div>
  );
}
