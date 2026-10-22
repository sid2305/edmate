'use client';
// Task 12.2e: the staff reports and takedowns console. The initial reports and takedowns come
// from the server page and are still checked with zod (a wrong shape or a failed server read is
// the fallback view, recoverable with Reload). Polls every `pollMs` (default 60 s, meets the
// "reaches staff < 5 minutes" acceptance for an open console); a failed poll after a good first
// load keeps the last lists and tries again, quietly; polling is paused -- skipped, not reset --
// whenever an action is in flight, so a slow reply can never land after a newer one. One action at
// a time across reports and takedowns: every action clears the old message, sets one busy flag and
// resets it in `finally` -- an error reply or a thrown call never leaves a button disabled
// (lessons: "UI state and server replies: trust neither, reset everything"). An `aria-live` region
// announces the open-report count on every change.
import type { ErrorCode } from '@edmate/contracts';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createTakedown as defaultCreateTakedown,
  liftTakedown as defaultLiftTakedown,
  loadReports as defaultLoadReports,
  loadTakedowns as defaultLoadTakedowns,
  ReportListSchema,
  reviewReport as defaultReviewReport,
  TakedownListSchema,
  type ReportView,
  type TakedownView,
} from './client';
import { ReportRow, type ReportAction } from './report-row';

const DEFAULT_POLL_MS = 60_000;

export interface StaffReportsViewProps {
  /** The server's read of the open reports; `null` when that read failed. Checked here, not trusted. */
  initialReports: unknown;
  /** The server's read of active takedowns; `null` when that read failed. Checked here, not trusted. */
  initialTakedowns: unknown;
  /** Tests inject fakes; defaults call `/api/staff/reports` and `/api/staff/takedowns`. */
  loadReports?: typeof defaultLoadReports;
  reviewReport?: typeof defaultReviewReport;
  loadTakedowns?: typeof defaultLoadTakedowns;
  createTakedown?: typeof defaultCreateTakedown;
  liftTakedown?: typeof defaultLiftTakedown;
  pollMs?: number;
}

type Busy =
  | { kind: 'report'; reportId: string; action: ReportAction }
  | { kind: 'lift'; takedownId: string }
  | { kind: 'reload' }
  | null;
type ErrorKey = 'forbidden' | 'not_found' | 'validation' | 'generic' | 'loadFailed';

function errorKey(code: ErrorCode): ErrorKey {
  return code === 'forbidden' || code === 'not_found' || code === 'validation' ? code : 'generic';
}

function parseReports(initial: unknown): ReportView[] | null {
  const parsed = ReportListSchema.safeParse(initial);
  return parsed.success ? parsed.data : null;
}

function parseTakedowns(initial: unknown): TakedownView[] | null {
  const parsed = TakedownListSchema.safeParse(initial);
  return parsed.success ? parsed.data : null;
}

export function StaffReportsView({
  initialReports,
  initialTakedowns,
  loadReports = defaultLoadReports,
  reviewReport = defaultReviewReport,
  loadTakedowns = defaultLoadTakedowns,
  createTakedown = defaultCreateTakedown,
  liftTakedown = defaultLiftTakedown,
  pollMs = DEFAULT_POLL_MS,
}: StaffReportsViewProps) {
  const t = useTranslations('staffReports');
  const [reports, setReports] = useState<ReportView[] | null>(() => parseReports(initialReports));
  const [takedowns, setTakedowns] = useState<TakedownView[] | null>(() =>
    parseTakedowns(initialTakedowns),
  );
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ErrorKey | null>(() =>
    parseReports(initialReports) === null || parseTakedowns(initialTakedowns) === null
      ? 'loadFailed'
      : null,
  );
  const [pollFailed, setPollFailed] = useState(false);
  const [notice, setNotice] = useState(false);
  const busyRef = useRef<Busy>(null);
  busyRef.current = busy;
  const loadedRef = useRef(
    parseReports(initialReports) !== null && parseTakedowns(initialTakedowns) !== null,
  );

  const refresh = useCallback(async () => {
    const [reportsResult, takedownsResult] = await Promise.all([loadReports(), loadTakedowns()]);
    if (reportsResult.ok && takedownsResult.ok) {
      loadedRef.current = true;
      setReports(reportsResult.reports);
      setTakedowns(takedownsResult.takedowns);
      setPollFailed(false);
      setError(null);
    } else if (loadedRef.current) {
      setPollFailed(true);
    } else {
      setError('loadFailed');
    }
  }, [loadReports, loadTakedowns]);

  const onReload = async () => {
    setError(null);
    setNotice(false);
    setBusy({ kind: 'reload' });
    try {
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  // Poll on a fixed schedule; paused (skipped, not reset) whenever an action is in flight.
  useEffect(() => {
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight || busyRef.current !== null) return;
      inFlight = true;
      void refresh().finally(() => {
        inFlight = false;
      });
    }, pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  const dropReport = (reportId: string) =>
    setReports((list) => (list ?? []).filter((r) => r.id !== reportId));

  const runReportAction = async (
    report: ReportView,
    action: ReportAction,
    run: () => Promise<{ ok: true } | { ok: false; code: ErrorCode }>,
  ) => {
    setError(null);
    setNotice(false);
    setBusy({ kind: 'report', reportId: report.id, action });
    try {
      const result = await run();
      if (!result.ok) {
        setError(errorKey(result.code));
        return;
      }
      dropReport(report.id);
      setNotice(true);
    } catch {
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  const onDismiss = (report: ReportView) =>
    void runReportAction(report, 'dismiss', () => reviewReport({ reportId: report.id, decision: 'dismissed' }));

  const onTakedownDocument = (report: ReportView, documentId: string) =>
    void runReportAction(report, `doc:${documentId}`, () =>
      createTakedown({
        kind: 'document',
        targetId: documentId,
        category: report.category,
        reportId: report.id,
      }),
    );

  const onTakedownAgent = (report: ReportView) => {
    if (report.agentId === null) return;
    void runReportAction(report, 'agent', () =>
      createTakedown({
        kind: 'agent',
        targetId: report.agentId as string,
        category: report.category,
        reportId: report.id,
      }),
    );
  };

  const onLift = async (takedown: TakedownView) => {
    setError(null);
    setNotice(false);
    setBusy({ kind: 'lift', takedownId: takedown.id });
    try {
      const result = await liftTakedown({ takedownId: takedown.id });
      if (!result.ok) {
        setError(errorKey(result.code));
        return;
      }
      setTakedowns((list) => (list ?? []).filter((td) => td.id !== takedown.id));
      setNotice(true);
    } catch {
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  const openCount = reports?.length ?? 0;

  return (
    <div className="staff-reports">
      <p>{t('intro')}</p>
      <p aria-live="polite" className="staff-reports-count">
        {t('openCount', { count: openCount })}
      </p>
      {error ? (
        <p role="alert" className="staff-reports-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      {!error && pollFailed ? (
        <p role="status" className="staff-reports-poll-error">
          {t('pollError')}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="staff-reports-notice">
          {t('done')}
        </p>
      ) : null}
      <p>
        <button type="button" disabled={busy !== null} onClick={() => void onReload()}>
          {busy?.kind === 'reload' ? t('reloading') : t('reload')}
        </button>
      </p>
      <h2>{t('queueHeading')}</h2>
      {reports === null ? null : reports.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ul className="staff-reports-list" aria-label={t('listLabel')}>
          {reports.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              pending={
                busy !== null && busy.kind === 'report' && busy.reportId === report.id
                  ? busy.action
                  : null
              }
              disabled={busy !== null}
              onDismiss={() => onDismiss(report)}
              onTakedownDocument={(documentId) => onTakedownDocument(report, documentId)}
              onTakedownAgent={() => onTakedownAgent(report)}
            />
          ))}
        </ul>
      )}
      <h2>{t('takedownsHeading')}</h2>
      {takedowns === null ? null : takedowns.length === 0 ? (
        <p>{t('noTakedowns')}</p>
      ) : (
        <ul className="staff-takedowns-list" aria-label={t('takedownsListLabel')}>
          {takedowns.map((takedown) => (
            <li key={takedown.id}>
              <span>{t(`takedownKind.${takedown.kind}`)}</span>{' '}
              <span>{takedown.teacherSlug ?? t('noTeacherSlug')}</span>{' '}
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onLift(takedown)}
              >
                {busy?.kind === 'lift' && busy.takedownId === takedown.id ? t('working') : t('lift')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
