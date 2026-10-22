'use client';
// Task 12.5c: the staff alert inbox. The initial list comes from the server page and is still
// checked with zod (a wrong shape or a failed server read is the fallback view, recoverable with
// Reload). Polls every `pollMs` (default 30 s): a failed poll after a good first load keeps the
// last list and tries again, quietly (no busy flag, a small status note); a failed first load (or
// a manual Reload) is the fallback. Polling is paused -- skipped, not reset -- whenever an
// acknowledgement or a manual reload is in flight, so a slow reply can never land after a newer
// one. Acknowledging clears the old message, sets one busy flag and resets it in `finally` -- an
// error reply or a thrown call never leaves the button disabled, and the row leaves the open list
// only on success (lessons: "UI state and server replies: trust neither, reset everything").
import type { ErrorCode } from '@edmate/contracts';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertRow } from './alert-row';
import {
  acknowledge as defaultAcknowledge,
  AlertListSchema,
  loadAlerts as defaultLoadAlerts,
  type AlertView,
} from './client';

const DEFAULT_POLL_MS = 30_000;

export interface StaffAlertViewProps {
  /** The server's read of the open alerts; `null` when that read failed. Checked here, not trusted. */
  initial: unknown;
  /** Tests inject fakes; defaults call `/api/staff/alerts`. */
  acknowledge?: typeof defaultAcknowledge;
  loadAlerts?: typeof defaultLoadAlerts;
  pollMs?: number;
}

type Busy = { kind: 'ack'; alertId: string } | { kind: 'reload' } | null;
type ErrorKey = 'forbidden' | 'not_found' | 'validation' | 'generic' | 'loadFailed';

function errorKey(code: ErrorCode): ErrorKey {
  return code === 'forbidden' || code === 'not_found' || code === 'validation' ? code : 'generic';
}

function parseInitial(initial: unknown): AlertView[] | null {
  const parsed = AlertListSchema.safeParse(initial);
  return parsed.success ? parsed.data : null;
}

/** Open alerts first (escalated or overdue ahead of the rest), each group oldest first. */
function sorted(alerts: AlertView[]): AlertView[] {
  const rank = (a: AlertView) => {
    if (a.acknowledgedAt !== null) return 2;
    return a.escalatedAt !== null || a.overdue ? 0 : 1;
  };
  return [...alerts].sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
}

const minutesOpen = (createdAt: string, now: number) =>
  Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));

export function StaffAlertView({
  initial,
  acknowledge = defaultAcknowledge,
  loadAlerts = defaultLoadAlerts,
  pollMs = DEFAULT_POLL_MS,
}: StaffAlertViewProps) {
  const t = useTranslations('staffAlerts');
  const [alerts, setAlerts] = useState<AlertView[] | null>(() => parseInitial(initial));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ErrorKey | null>(() =>
    parseInitial(initial) === null ? 'loadFailed' : null,
  );
  const [pollFailed, setPollFailed] = useState(false);
  const [notice, setNotice] = useState(false);
  const busyRef = useRef<Busy>(null);
  busyRef.current = busy;
  const loadedRef = useRef(parseInitial(initial) !== null);

  const refresh = useCallback(async () => {
    const result = await loadAlerts('open');
    if (result.ok) {
      loadedRef.current = true;
      setAlerts(result.alerts);
      setPollFailed(false);
      setError(null);
    } else if (loadedRef.current) {
      setPollFailed(true);
    } else {
      setError('loadFailed');
    }
  }, [loadAlerts]);

  const onReload = async () => {
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

  const onAcknowledge = async (alert: AlertView, note: string) => {
    setError(null);
    setNotice(false);
    setBusy({ kind: 'ack', alertId: alert.id });
    try {
      const result = await acknowledge({ alertId: alert.id, note });
      if (!result.ok) {
        setError(errorKey(result.code));
        return;
      }
      setAlerts((list) => (list ?? []).filter((a) => a.id !== alert.id));
      setNotice(true);
    } catch {
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  const now = Date.now();

  return (
    <div className="staff-alerts">
      <p>{t('intro')}</p>
      {error ? (
        <p role="alert" className="staff-alerts-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      {!error && pollFailed ? (
        <p role="status" className="staff-alerts-poll-error">
          {t('pollError')}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="staff-alerts-notice">
          {t('acked')}
        </p>
      ) : null}
      <p>
        <button type="button" disabled={busy !== null} onClick={() => void onReload()}>
          {busy?.kind === 'reload' ? t('reloading') : t('reload')}
        </button>
      </p>
      {alerts === null ? null : alerts.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ul className="staff-alerts-list" aria-label={t('listLabel')}>
          {sorted(alerts).map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              minutesOpen={minutesOpen(alert.createdAt, now)}
              pending={busy?.kind === 'ack' && busy.alertId === alert.id}
              disabled={busy !== null}
              onAcknowledge={(note) => void onAcknowledge(alert, note)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
