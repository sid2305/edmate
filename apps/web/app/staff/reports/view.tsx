'use client';
// Task 12.2e (12.2g follow-ups): the staff reports and takedowns console. The initial reports and
// takedowns come from the server page and are still checked with zod (a wrong shape or a failed
// server read is the fallback view, recoverable with Reload). Polls every `pollMs` (default 60 s,
// meets the "reaches staff < 5 minutes" acceptance for an open console); a failed poll after a
// good first load keeps the last lists and tries again, quietly; polling is paused -- skipped, not
// reset -- whenever an action is in flight (no call lands at all), *and* a generation ref that
// every action and every manual reload bumps makes a poll's own stale reply a no-op: `refresh`
// captures the current generation before it awaits, and drops its result (never touching state)
// if the generation moved on while it was in flight. That is what actually stops a late poll GET
// from reviving a report or takedown a newer action just removed (the header comment used to claim
// "a slow reply can never land after a newer one", but pausing polling while busy does not cover a
// poll that was already in flight *before* the action started -- 12.2e review). One action at a
// time across reports and takedowns: every action bumps the generation, clears the old message,
// sets one busy flag and resets it in `finally` -- an error reply or a thrown call never leaves a
// button disabled (lessons: "UI state and server replies: trust neither, reset everything"); a
// rejecting loader is caught inside `refresh` itself, so it never becomes an unhandled rejection
// from the poll's `void refresh()`. A poll's own success clears only a stale `loadFailed`, never an
// action's own error message. An `aria-live` region announces the open-report count (ICU plural;
// no count at all in the fallback view, where there is nothing to count) on every change.
import type { ErrorCode } from '@edmate/contracts';
import { useFormatter, useTranslations } from 'next-intl';
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
/** Task 9.3g: a lifted agent takedown that landed the agent back in `draft` gets its own notice. */
type Notice = { kind: 'done' } | { kind: 'liftedAgentDraft' } | null;

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
  const format = useFormatter();
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
  const [notice, setNotice] = useState<Notice>(null);
  const busyRef = useRef<Busy>(null);
  busyRef.current = busy;
  const loadedRef = useRef(
    parseReports(initialReports) !== null && parseTakedowns(initialTakedowns) !== null,
  );
  // Bumped by every action and every manual reload (see the file header); `refresh` captures this
  // before it awaits and drops its own result if it no longer matches when the awaited calls
  // settle -- a stale poll (or a stale reload) can never overwrite newer local state.
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = generationRef.current;
    let reportsResult: Awaited<ReturnType<typeof loadReports>>;
    let takedownsResult: Awaited<ReturnType<typeof loadTakedowns>>;
    try {
      [reportsResult, takedownsResult] = await Promise.all([loadReports(), loadTakedowns()]);
    } catch {
      if (generationRef.current !== generation) return;
      if (loadedRef.current) setPollFailed(true);
      else setError('loadFailed');
      return;
    }
    if (generationRef.current !== generation) return;
    if (reportsResult.ok && takedownsResult.ok) {
      loadedRef.current = true;
      setReports(reportsResult.reports);
      setTakedowns(takedownsResult.takedowns);
      setPollFailed(false);
      setError((e) => (e === 'loadFailed' ? null : e));
    } else if (loadedRef.current) {
      setPollFailed(true);
    } else {
      setError('loadFailed');
    }
  }, [loadReports, loadTakedowns]);

  const onReload = async () => {
    generationRef.current += 1;
    setError(null);
    setNotice(null);
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
    generationRef.current += 1;
    setError(null);
    setNotice(null);
    setBusy({ kind: 'report', reportId: report.id, action });
    try {
      const result = await run();
      if (!result.ok) {
        setError(errorKey(result.code));
        return;
      }
      dropReport(report.id);
      setNotice({ kind: 'done' });
    } catch {
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  const onDismiss = (report: ReportView) =>
    void runReportAction(report, 'dismiss', () =>
      reviewReport({ reportId: report.id, decision: 'dismissed' }),
    );

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
    const agentId = report.agentId;
    if (agentId === null) return;
    void runReportAction(report, 'agent', () =>
      createTakedown({
        kind: 'agent',
        targetId: agentId,
        category: report.category,
        reportId: report.id,
      }),
    );
  };

  const onLift = async (takedown: TakedownView) => {
    generationRef.current += 1;
    setError(null);
    setNotice(null);
    setBusy({ kind: 'lift', takedownId: takedown.id });
    try {
      const result = await liftTakedown({ takedownId: takedown.id });
      if (!result.ok) {
        setError(errorKey(result.code));
        return;
      }
      setTakedowns((list) => (list ?? []).filter((td) => td.id !== takedown.id));
      setNotice(
        takedown.kind === 'agent' && result.agentStatus === 'draft'
          ? { kind: 'liftedAgentDraft' }
          : { kind: 'done' },
      );
    } catch {
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  const takenDownAgentIds = new Set(
    (takedowns ?? [])
      .filter((td): td is TakedownView & { kind: 'agent' } => td.kind === 'agent')
      .map((td) => td.targetId),
  );

  return (
    <div className="staff-reports">
      <p>{t('intro')}</p>
      {reports === null ? null : (
        <p aria-live="polite" className="staff-reports-count">
          {t('openCount', { count: reports.length })}
        </p>
      )}
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
          {t(notice.kind)}
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
              agentTakenDown={report.agentId !== null && takenDownAgentIds.has(report.agentId)}
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
              <dl>
                <dt>{t('takedownTargetLabel')}</dt>
                <dd>{takedown.targetId}</dd>
                <dt>{t('takedownCategoryLabel')}</dt>
                <dd>{t(`category.${takedown.category}`)}</dd>
                <dt>{t('takedownWhenLabel')}</dt>
                <dd>
                  {format.dateTime(new Date(takedown.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'UTC',
                  })}
                </dd>
              </dl>
              <button
                type="button"
                disabled={busy !== null}
                aria-label={t('liftAriaLabel', { targetId: takedown.targetId })}
                onClick={() => void onLift(takedown)}
              >
                {busy?.kind === 'lift' && busy.takedownId === takedown.id
                  ? t('working')
                  : t('lift')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
