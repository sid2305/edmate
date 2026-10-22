'use client';
// Task 12.5c: one alert in the staff inbox. The excerpt is rendered as plain text (never HTML).
// An escalated or overdue, still-open alert shows the marker; the note is this row's own state,
// the busy flag belongs to the parent view.
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AlertView } from './client';

const MAX_NOTE_CHARS = 500;

const LEVEL_KEYS = ['info', 'alert', 'critical'] as const;
const KIND_KEYS = ['distress', 'abuse', 'misuse', 'other'] as const;

export interface AlertRowProps {
  alert: AlertView;
  /** Minutes since the alert was raised, for the escalated/overdue marker. */
  minutesOpen: number;
  /** An acknowledgement is in flight for this row. */
  pending: boolean;
  /** Any row's action is in flight (one at a time). */
  disabled: boolean;
  onAcknowledge(note: string): void;
}

export function AlertRow({ alert, minutesOpen, pending, disabled, onAcknowledge }: AlertRowProps) {
  const t = useTranslations('staffAlerts');
  const [note, setNote] = useState('');
  const headingId = `alert-row-${alert.id}`;
  const noteId = `alert-note-${alert.id}`;
  const open = alert.acknowledgedAt === null;
  const flagged = open && (alert.escalatedAt !== null || alert.overdue);

  return (
    <li className="alert-row" aria-labelledby={headingId}>
      <h2 id={headingId}>{t(`level.${LEVEL_KEYS.includes(alert.level) ? alert.level : 'alert'}`)}</h2>
      {flagged ? (
        <p role="alert" className="alert-escalated">
          {t('escalatedMarker', { minutes: minutesOpen, rounds: alert.escalationRound })}
        </p>
      ) : null}
      <dl>
        <dt>{t('kindLabel')}</dt>
        <dd>{t(`kind.${KIND_KEYS.includes(alert.kind) ? alert.kind : 'other'}`)}</dd>
        <dt>{t('teacher')}</dt>
        <dd>{alert.teacherSlug ?? t('noTeacherSlug')}</dd>
        <dt>{t('excerpt')}</dt>
        <dd>{alert.excerptRedacted}</dd>
      </dl>
      {open ? (
        <>
          <p className="alert-field">
            <label htmlFor={noteId}>{t('noteLabel')}</label>
            <textarea
              id={noteId}
              value={note}
              maxLength={MAX_NOTE_CHARS}
              onChange={(e) => setNote(e.target.value)}
            />
          </p>
          <p className="alert-actions">
            <button type="button" disabled={disabled} onClick={() => onAcknowledge(note)}>
              {pending ? t('acking') : t('acknowledge')}
            </button>
          </p>
        </>
      ) : (
        <p className="alert-acked">{t('acked')}</p>
      )}
    </li>
  );
}
