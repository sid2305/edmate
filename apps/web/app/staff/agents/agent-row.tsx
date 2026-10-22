'use client';
// Task 12.4d: one agent in the staff regulated-subject console. The subject select is this row's
// own state (committed with Save); approving or revoking needs a confirm step first, so a
// misclick never changes a live agent's gate. The busy flag belongs to the parent view.
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AgentView } from './client';

const SUBJECT_KEYS = ['investing', 'health', 'law'] as const;
type SubjectOption = (typeof SUBJECT_KEYS)[number] | '';

export interface AgentRowProps {
  agent: AgentView;
  /** Which action is in flight for this row, if any (that button says so). */
  pending: 'subject' | 'approval' | null;
  /** Any row's action is in flight (one at a time). */
  disabled: boolean;
  onSetSubject(subject: 'investing' | 'health' | 'law' | null): void;
  onSetApproval(approved: boolean): void;
}

export function AgentRow({ agent, pending, disabled, onSetSubject, onSetApproval }: AgentRowProps) {
  const t = useTranslations('staffAgents');
  const [subject, setSubjectValue] = useState<SubjectOption>(agent.regulatedSubject ?? '');
  const [confirming, setConfirming] = useState(false);
  const headingId = `agent-row-${agent.agentId}`;
  const subjectId = `agent-subject-${agent.agentId}`;
  const approved = agent.approvedAt !== null;
  const dirty = subject !== (agent.regulatedSubject ?? '');

  const save = () => onSetSubject(subject === '' ? null : subject);
  const ask = () => setConfirming(true);
  const cancel = () => setConfirming(false);
  const confirm = () => {
    setConfirming(false);
    onSetApproval(!approved);
  };

  return (
    <li className="agent-row" aria-labelledby={headingId}>
      <h2 id={headingId}>{agent.teacherSlug ?? t('noTeacherSlug')}</h2>
      <dl>
        <dt>{t('statusLabel')}</dt>
        <dd>{t(`status.${agent.status}`)}</dd>
        {approved ? (
          <>
            <dt>{t('approvedAtLabel')}</dt>
            <dd>{agent.approvedAt}</dd>
          </>
        ) : null}
      </dl>
      <p className="agent-field">
        <label htmlFor={subjectId}>{t('subjectLabel')}</label>
        <select
          id={subjectId}
          value={subject}
          disabled={disabled}
          onChange={(e) => setSubjectValue(e.target.value as SubjectOption)}
        >
          <option value="">{t('subjectNone')}</option>
          {SUBJECT_KEYS.map((k) => (
            <option key={k} value={k}>
              {t(`subject.${k}`)}
            </option>
          ))}
        </select>{' '}
        <button type="button" disabled={disabled || !dirty} onClick={save}>
          {pending === 'subject' ? t('saving') : t('save')}
        </button>
      </p>
      <p className="agent-actions">
        {agent.regulatedSubject === null ? null : confirming ? (
          <>
            <span role="alert">{t(approved ? 'confirmRevoke' : 'confirmApprove')}</span>{' '}
            <button type="button" disabled={disabled} onClick={confirm}>
              {pending === 'approval' ? t('saving') : t('confirmYes')}
            </button>{' '}
            <button type="button" disabled={disabled} onClick={cancel}>
              {t('confirmCancel')}
            </button>
          </>
        ) : (
          <button type="button" disabled={disabled} onClick={ask}>
            {pending === 'approval' ? t('saving') : t(approved ? 'revoke' : 'approve')}
          </button>
        )}
      </p>
    </li>
  );
}
