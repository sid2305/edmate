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
  /** The busy/done half of this message's report state, lifted by the caller and keyed by
   * `messageId` (fix round, 22 Oct 2026): a final turn is first shown here, then re-rendered as a
   * new instance once it joins the persisted thread, so "reported" cannot live in this
   * component's own state or a report in flight -- or its "Thanks" result -- would be lost on that
   * remount. Undefined (this component's own tests, unlifted) falls back to local state only. */
  status?: 'busy' | 'done' | undefined;
  onStatusChange?: (status: 'idle' | 'busy' | 'done') => void;
  /** Injected in tests; the real fetch-based client otherwise. */
  report?: (input: {
    sessionId: string;
    agentId: string;
    messageId: string;
    category: ReportCategory;
  }) => Promise<ReportMessageResult>;
}

type Phase = 'closed' | 'open' | 'busy' | 'done';

export function ReportButton({
  agentId,
  sessionId,
  messageId,
  status,
  onStatusChange,
  report = realReportMessage,
}: ReportButtonProps) {
  const t = useTranslations('report');
  const groupId = useId();
  const [localPhase, setLocalPhase] = useState<Phase>('closed');
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (sessionId === null) return null;
  const openSessionId: string = sessionId;

  // The lifted `status` (busy/done) wins when present -- it is what survives this component
  // remounting under a new key -- otherwise this instance's own closed/open/busy/done runs the
  // show (this component's own tests, which never pass `status`).
  const phase: Phase = status ?? localPhase;

  if (phase === 'done') {
    return (
      <p className="report-thanks" role="status">
        {t('thanks')}
      </p>
    );
  }

  if (phase === 'closed') {
    return (
      <button type="button" className="report-open" onClick={() => setLocalPhase('open')}>
        {t('button')}
      </button>
    );
  }

  const busy = phase === 'busy';

  async function send() {
    if (category === null) return;
    setLocalPhase('busy');
    onStatusChange?.('busy');
    setError(null);
    try {
      const result = await report({ sessionId: openSessionId, agentId, messageId, category });
      if (result.ok) {
        setLocalPhase('done');
        onStatusChange?.('done');
      } else {
        setError(errorText(result.code));
        setLocalPhase('open');
        onStatusChange?.('idle');
      }
    } catch {
      setError(errorText('provider_error'));
      setLocalPhase('open');
      onStatusChange?.('idle');
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
      <button type="button" disabled={busy} onClick={() => setLocalPhase('closed')}>
        {t('cancel')}
      </button>
    </div>
  );
}
