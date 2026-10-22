'use client';
// Task 12.2e: one open report in the staff queue. The reported text goes through `renderReply`
// (React text nodes only, same as the chat itself); staff never see the reporter's id, name or
// email (12.2a never sends them). Dismiss, "take down this document" (one per cited document) and
// "take down this agent" each need their own confirm step first, so a misclick never dismisses a
// report or takes down live material. One action at a time across the whole row (the parent's
// `disabled`); `pending` names which action, if any, is this row's own.
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { renderReply } from '../../../src/chat/renderReply';
import type { ReportView } from './client';

/** `'dismiss'`, `'agent'`, or `doc:<documentId>` for one cited document's takedown. */
export type ReportAction = 'dismiss' | 'agent' | `doc:${string}`;

export interface ReportRowProps {
  report: ReportView;
  /** Which action is in flight for this row, if any (that button says so). */
  pending: ReportAction | null;
  /** Any row's action is in flight (one at a time). */
  disabled: boolean;
  onDismiss(): void;
  onTakedownDocument(documentId: string): void;
  onTakedownAgent(): void;
}

const CATEGORY_KEYS = ['harmful', 'inappropriate', 'wrong_information', 'copyright', 'other'] as const;

export function ReportRow({
  report,
  pending,
  disabled,
  onDismiss,
  onTakedownDocument,
  onTakedownAgent,
}: ReportRowProps) {
  const t = useTranslations('staffReports');
  const [confirming, setConfirming] = useState<ReportAction | null>(null);
  const headingId = `report-row-${report.id}`;

  const ask = (action: ReportAction) => setConfirming(action);
  const cancel = () => setConfirming(null);
  const run = (action: ReportAction, commit: () => void) => {
    setConfirming(null);
    if (action === confirming) commit();
  };

  const confirmButtons = (action: ReportAction, commit: () => void) =>
    confirming === action ? (
      <>
        <span role="alert">{t('confirmText')}</span>{' '}
        <button type="button" disabled={disabled} onClick={() => run(action, commit)}>
          {pending === action ? t('working') : t('confirmYes')}
        </button>{' '}
        <button type="button" disabled={disabled} onClick={cancel}>
          {t('confirmCancel')}
        </button>
      </>
    ) : null;

  return (
    <li className="report-row" aria-labelledby={headingId}>
      <h2 id={headingId}>
        {t(`category.${CATEGORY_KEYS.includes(report.category) ? report.category : 'other'}`)}
      </h2>
      <dl>
        <dt>{t('whenLabel')}</dt>
        <dd>{report.createdAt}</dd>
        <dt>{t('teacherLabel')}</dt>
        <dd>{report.teacherSlug ?? t('noTeacherSlug')}</dd>
      </dl>
      {report.message === null ? (
        <p className="report-missing">{t('messageGone')}</p>
      ) : (
        <div className="report-message">{renderReply(report.message.text)}</div>
      )}
      {report.citedDocuments.length === 0 ? null : (
        <ul className="report-documents" aria-label={t('citedDocumentsLabel')}>
          {report.citedDocuments.map((doc) => {
            const action: ReportAction = `doc:${doc.id}`;
            return (
              <li key={doc.id}>
                {doc.title}{' '}
                {doc.takenDown ? (
                  <span>{t('alreadyTakenDown')}</span>
                ) : confirming === action ? (
                  confirmButtons(action, () => onTakedownDocument(doc.id))
                ) : (
                  <button type="button" disabled={disabled} onClick={() => ask(action)}>
                    {pending === action ? t('working') : t('takedownDocument')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="report-actions">
        {confirming === 'dismiss' ? (
          confirmButtons('dismiss', onDismiss)
        ) : (
          <button type="button" disabled={disabled} onClick={() => ask('dismiss')}>
            {pending === 'dismiss' ? t('working') : t('dismiss')}
          </button>
        )}{' '}
        {report.agentId === null ? null : confirming === 'agent' ? (
          confirmButtons('agent', onTakedownAgent)
        ) : (
          <button type="button" disabled={disabled} onClick={() => ask('agent')}>
            {pending === 'agent' ? t('working') : t('takedownAgent')}
          </button>
        )}
      </p>
    </li>
  );
}
