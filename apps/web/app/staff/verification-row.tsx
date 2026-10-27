'use client';
// Task 12.1b: one pending teacher in the staff console, with an optional reason and the approve /
// reject buttons. The reason is this row's own state; the busy flag belongs to the parent view.
// Task 9.3e: a "safety concern" checkbox (row state too) makes Reject a safety rejection; Approve
// always sends `false`.
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { MAX_REASON_CHARS, type Decision, type QueueItem } from './client';

export interface VerificationRowProps {
  item: QueueItem;
  /** The decision in flight for this row, if any (that button says so). */
  pending: Decision | null;
  /** Any action is in flight (one at a time). */
  disabled: boolean;
  /**
   * Task 9.3f: set only when this row comes from the slug lookup, where the teacher's current
   * status isn't implied by the list it's in (unlike the pending queue). Shown as an extra
   * `dt`/`dd` pair so staff see what they are about to change.
   */
  currentStatus?: 'pending' | 'verified' | 'rejected';
  onDecide(status: Decision, reason: string, safety: boolean): void;
}

export function VerificationRow({
  item,
  pending,
  disabled,
  currentStatus,
  onDecide,
}: VerificationRowProps) {
  const t = useTranslations('staff');
  const format = useFormatter();
  const [reason, setReason] = useState('');
  const [safety, setSafety] = useState(false);
  const headingId = `staff-row-${item.teacherId}`;
  const reasonId = `staff-reason-${item.teacherId}`;
  const safetyId = `staff-safety-${item.teacherId}`;
  const safetyHintId = `staff-safety-hint-${item.teacherId}`;
  return (
    <li className="staff-row" aria-labelledby={headingId}>
      <h2 id={headingId}>{item.slug}</h2>
      <dl>
        {currentStatus === undefined ? null : (
          <>
            <dt>{t('currentStatusLabel')}</dt>
            <dd>{t(`status.${currentStatus}`)}</dd>
          </>
        )}
        <dt>{t('subject')}</dt>
        <dd>{item.subject}</dd>
        <dt>{t('name')}</dt>
        <dd>{item.name}</dd>
        <dt>{t('email')}</dt>
        <dd>{item.email ?? t('noEmail')}</dd>
        <dt>{t('activeTakedownsLabel')}</dt>
        <dd>
          {item.activeTakedowns.length === 0
            ? t('activeTakedownsNone')
            : t('activeTakedownsCount', { count: item.activeTakedowns.length })}
        </dd>
        <dt>{t('lastDecisionLabel')}</dt>
        <dd>
          {item.lastDecision === null
            ? t('lastDecisionNone')
            : t('lastDecisionLine', {
                status: t(`status.${item.lastDecision.status}`),
                date: format.dateTime(new Date(item.lastDecision.ts), {
                  dateStyle: 'medium',
                  timeZone: 'UTC',
                }),
              })}
        </dd>
        <dt>{t('subjectHistoryLabel')}</dt>
        <dd>
          {item.subjectHistory.length === 0 ? (
            t('subjectHistoryNone')
          ) : (
            <ul>
              {item.subjectHistory.map((change, i) => (
                <li key={`${change.ts}|${change.from}|${change.to}|${i}`}>
                  {t('subjectHistoryLine', {
                    from: change.from,
                    to: change.to,
                    date: format.dateTime(new Date(change.ts), {
                      dateStyle: 'medium',
                      timeZone: 'UTC',
                    }),
                  })}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      <p className="staff-field">
        <label htmlFor={reasonId}>{t('reasonLabel')}</label>
        <textarea
          id={reasonId}
          value={reason}
          maxLength={MAX_REASON_CHARS}
          onChange={(e) => setReason(e.target.value)}
        />
      </p>
      <p className="staff-field">
        <input
          id={safetyId}
          type="checkbox"
          checked={safety}
          aria-describedby={safetyHintId}
          onChange={(e) => setSafety(e.target.checked)}
        />{' '}
        <label htmlFor={safetyId}>{t('safetyLabel')}</label>
      </p>
      <p id={safetyHintId} className="staff-hint">
        {t('safetyHint')}
      </p>
      <p className="staff-actions">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDecide('verified', reason, false)}
        >
          {pending === 'verified' ? t('working') : t('approve')}
        </button>{' '}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDecide('rejected', reason, safety)}
        >
          {pending === 'rejected' ? t('working') : t('reject')}
        </button>
      </p>
    </li>
  );
}
