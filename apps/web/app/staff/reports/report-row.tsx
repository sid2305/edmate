'use client';
// Task 12.2e (12.2g follow-ups): one open report in the staff queue. The reported text is shown
// as plain text, never as markdown: it is a JSX text child, with line breaks kept by CSS
// (`white-space: pre-wrap`), so no markdown syntax is parsed and no `<a>` is ever created from
// it (a reporter-quoted `[text](https://evil.test)` stays literal text) -- staff never see the
// reporter's id, name or email either (12.2a never sends them). Dismiss, "take down this
// document" (one per cited document) and "take down this agent" each need their own confirm step
// first, so a misclick never dismisses a report or takes down live material; dismiss's confirm
// text is its own (undoable: dismissing again later needs a new report), the two takedown
// confirms share a different text (they can be lifted from this same page, below). One action at
// a time across the whole row (the parent's `disabled`); `pending` names which action, if any, is
// this row's own. `report.category` is always one of `REPORT_CATEGORIES` (the server's zod enum),
// so no fallback branch is reachable.
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ReportView } from './client';

/** `'dismiss'`, `'agent'`, or `doc:<documentId>` for one cited document's takedown. */
export type ReportAction = 'dismiss' | 'agent' | `doc:${string}`;

export interface ReportRowProps {
  report: ReportView;
  /** Which action is in flight for this row, if any (that button says so). */
  pending: ReportAction | null;
  /** Any row's action is in flight (one at a time). */
  disabled: boolean;
  /** An active agent takedown already exists for this report's agent: hide the agent button. */
  agentTakenDown: boolean;
  onDismiss(): void;
  onTakedownDocument(documentId: string): void;
  onTakedownAgent(): void;
}

function confirmTextKeyFor(action: ReportAction): 'confirmText' | 'confirmTextTakedown' {
  return action === 'dismiss' ? 'confirmText' : 'confirmTextTakedown';
}

export function ReportRow({
  report,
  pending,
  disabled,
  agentTakenDown,
  onDismiss,
  onTakedownDocument,
  onTakedownAgent,
}: ReportRowProps) {
  const t = useTranslations('staffReports');
  const format = useFormatter();
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
        <span role="alert">{t(confirmTextKeyFor(action))}</span>{' '}
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
      <h2 id={headingId}>{t(`category.${report.category}`)}</h2>
      <dl>
        <dt>{t('whenLabel')}</dt>
        <dd>
          {format.dateTime(new Date(report.createdAt), {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'UTC',
          })}
        </dd>
        <dt>{t('teacherLabel')}</dt>
        <dd>{report.teacherSlug ?? t('noTeacherSlug')}</dd>
      </dl>
      {report.message === null ? (
        <p className="report-missing">{t('messageGone')}</p>
      ) : (
        <p className="report-message" style={{ whiteSpace: 'pre-wrap' }}>
          {report.message.text}
        </p>
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
        {report.agentId === null || agentTakenDown ? null : confirming === 'agent' ? (
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
