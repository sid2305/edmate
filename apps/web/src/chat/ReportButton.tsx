'use client';
// Task 12.2c: reports one agent or teacher reply. Closed shows one small "Report" button; open
// shows a category radio group (12.2 Q2: a closed set, no free text) with Send and Cancel. Send
// disables itself while the request is in flight (try/catch/finally on the busy flag, 8.4b/9.5a
// lesson); success shows a fixed "thanks" line and disables Report for this message for good;
// a failure shows fixed text (never the server's own message) and reopens the form to retry.
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { errorText } from './errorText';
import {
  reportMessage as realReportMessage,
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportMessageResult,
} from './reportMessage';

export interface ReportButtonProps {
  agentId: string;
  /** The open session this message belongs to; no session, no report (nothing is rendered). */
  sessionId: string | null;
  messageId: string;
  /** Injected in tests; the real fetch-based client otherwise. */
  report?: (input: {
    sessionId: string;
    agentId: string;
    messageId: string;
    category: ReportCategory;
  }) => Promise<ReportMessageResult>;
}

type Phase = 'closed' | 'open' | 'busy' | 'done';

export function ReportButton({ agentId, sessionId, messageId, report = realReportMessage }: ReportButtonProps) {
  const t = useTranslations('report');
  const groupId = useId();
  const [phase, setPhase] = useState<Phase>('closed');
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (sessionId === null) return null;

  if (phase === 'done') {
    return (
      <p className="report-thanks" role="status">
        {t('thanks')}
      </p>
    );
  }

  if (phase === 'closed') {
    return (
      <button type="button" className="report-open" onClick={() => setPhase('open')}>
        {t('button')}
      </button>
    );
  }

  const busy = phase === 'busy';

  async function send() {
    if (category === null) return;
    setPhase('busy');
    setError(null);
    try {
      const result = await report({ sessionId: sessionId as string, agentId, messageId, category });
      if (result.ok) {
        setPhase('done');
      } else {
        setError(errorText(result.code));
        setPhase('open');
      }
    } catch {
      setError(errorText('provider_error'));
      setPhase('open');
    }
  }

  return (
    <div className="report-form">
      <fieldset disabled={busy}>
        <legend id={`${groupId}-legend`}>{t('categoryLabel')}</legend>
        <div role="radiogroup" aria-labelledby={`${groupId}-legend`}>
          {REPORT_CATEGORIES.map((c) => (
            <label key={c} className="report-category">
              <input
                type="radio"
                name={`${groupId}-category`}
                value={c}
                checked={category === c}
                onChange={() => setCategory(c)}
              />
              {t(`categories.${c}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {error === null ? null : (
        <p className="report-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" disabled={busy || category === null} onClick={() => void send()}>
        {busy ? t('sending') : t('send')}
      </button>
      <button type="button" disabled={busy} onClick={() => setPhase('closed')}>
        {t('cancel')}
      </button>
    </div>
  );
}
