'use client';
// Task 12.1b: the staff verification console. The initial list comes from the server page and is
// still checked with zod (a wrong shape or a failed server read is the fallback view with a
// reload). One action at a time: every action clears the old message, sets the busy flag, and
// resets it in `finally` -- an error reply or a thrown call never leaves the buttons disabled. An
// approved or rejected teacher leaves the list (lessons: "UI state and server replies: trust
// neither, reset everything").
import type { ErrorCode } from '@edmate/contracts';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  decide as defaultDecide,
  loadQueue as defaultLoadQueue,
  QueueSchema,
  type Decision,
  type QueueItem,
} from './client';
import { VerificationRow } from './verification-row';

export interface StaffQueueViewProps {
  /** The server's read of the queue; `null` when that read failed. Checked here, not trusted. */
  initial: unknown;
  /** Tests inject fakes; defaults call `/api/staff/verifications`. */
  decide?: typeof defaultDecide;
  loadQueue?: typeof defaultLoadQueue;
}

type Busy = { kind: 'decide'; teacherId: string; status: Decision } | { kind: 'reload' } | null;
type ErrorKey = 'forbidden' | 'not_found' | 'validation' | 'generic' | 'loadFailed';
type Notice = { status: Decision; slug: string; safety: boolean } | null;

function errorKey(code: ErrorCode): ErrorKey {
  return code === 'forbidden' || code === 'not_found' || code === 'validation' ? code : 'generic';
}

function parseInitial(initial: unknown): QueueItem[] | null {
  const parsed = QueueSchema.safeParse(initial);
  return parsed.success ? parsed.data : null;
}

export function StaffQueueView({
  initial,
  decide = defaultDecide,
  loadQueue = defaultLoadQueue,
}: StaffQueueViewProps) {
  const t = useTranslations('staff');
  const [teachers, setTeachers] = useState<QueueItem[] | null>(() => parseInitial(initial));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ErrorKey | null>(() =>
    parseInitial(initial) === null ? 'loadFailed' : null,
  );
  const [notice, setNotice] = useState<Notice>(null);

  const onDecide = async (item: QueueItem, status: Decision, reason: string, safety: boolean) => {
    setError(null);
    setNotice(null);
    setBusy({ kind: 'decide', teacherId: item.teacherId, status });
    try {
      const result = await decide({ teacherId: item.teacherId, status, reason, safety });
      if (!result.ok) {
        setError(errorKey(result.code));
        return;
      }
      setTeachers((list) => (list ?? []).filter((x) => x.teacherId !== item.teacherId));
      setNotice({
        status: result.verificationStatus,
        slug: item.slug,
        safety: safety && result.verificationStatus === 'rejected',
      });
    } catch {
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  const onReload = async () => {
    setError(null);
    setNotice(null);
    setBusy({ kind: 'reload' });
    try {
      const result = await loadQueue();
      if (!result.ok) {
        setError('loadFailed');
        return;
      }
      setTeachers(result.teachers);
    } catch {
      setError('loadFailed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="staff-queue">
      <p>{t('intro')}</p>
      {error ? (
        <p role="alert" className="staff-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="staff-notice">
          {t(
            notice.status === 'verified' ? 'approved' : notice.safety ? 'rejectedSafety' : 'rejected',
            { slug: notice.slug },
          )}
        </p>
      ) : null}
      <p>
        <button type="button" disabled={busy !== null} onClick={() => void onReload()}>
          {busy?.kind === 'reload' ? t('reloading') : t('reload')}
        </button>
      </p>
      {teachers === null ? null : teachers.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ul className="staff-list" aria-label={t('listLabel')}>
          {teachers.map((item) => (
            <VerificationRow
              key={item.teacherId}
              item={item}
              pending={busy?.kind === 'decide' && busy.teacherId === item.teacherId ? busy.status : null}
              disabled={busy !== null}
              onDecide={(status, reason, safety) => void onDecide(item, status, reason, safety)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
