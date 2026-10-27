'use client';
// Task 12.3d: the repeat-infringer list (B-63). A trimmed `StaffQueueView`: no slug-search form,
// no pending-queue concept -- every row here is already a flag, and staff's only actions are the
// existing Approve ("reviewed, no action") / Reject ("suspend") on `<VerificationRow>`. The
// initial list comes from the server page and is still checked with zod (a wrong shape or a
// failed server read is the fallback view, recoverable with Reload). One action at a time: every
// action clears the old message, sets the busy flag and resets it in `finally` (lessons: "UI state
// and server replies: trust neither, reset everything"). An acted-on teacher leaves the list --
// not because they are no longer a repeat infringer (a reject keeps all three takedowns active),
// but because staff have now acted on this flag, same as `StaffQueueView`'s non-lookup branch.
import type { ErrorCode } from '@edmate/contracts';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { z } from 'zod';
import {
  decide as defaultDecide,
  LookupItemSchema,
  type Decision,
  type LookupItem,
} from '../client';
import { VerificationRow } from '../verification-row';
import { loadFlagged as defaultLoadFlagged } from './client';

const FlaggedListSchema = z.array(LookupItemSchema);

export interface StaffRepeatInfringersViewProps {
  /** The server's read of the flagged list; `null` when that read failed. Checked here, not trusted. */
  initial: unknown;
  /** Tests inject fakes; defaults call `/api/staff/verifications` and `/api/staff/repeat-infringers`. */
  decide?: typeof defaultDecide;
  loadFlagged?: typeof defaultLoadFlagged;
}

type Busy = { kind: 'decide'; teacherId: string; status: Decision } | { kind: 'reload' } | null;
type ErrorKey = 'forbidden' | 'not_found' | 'validation' | 'generic' | 'loadFailed';
type Notice = { status: Decision; slug: string; safety: boolean } | null;

function errorKey(code: ErrorCode): ErrorKey {
  return code === 'forbidden' || code === 'not_found' || code === 'validation' ? code : 'generic';
}

function parseInitial(initial: unknown): LookupItem[] | null {
  const parsed = FlaggedListSchema.safeParse(initial);
  return parsed.success ? parsed.data : null;
}

export function StaffRepeatInfringersView({
  initial,
  decide = defaultDecide,
  loadFlagged = defaultLoadFlagged,
}: StaffRepeatInfringersViewProps) {
  const t = useTranslations('staffRepeatInfringers');
  const staffT = useTranslations('staff');
  const [teachers, setTeachers] = useState<LookupItem[] | null>(() => parseInitial(initial));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ErrorKey | null>(() =>
    parseInitial(initial) === null ? 'loadFailed' : null,
  );
  const [notice, setNotice] = useState<Notice>(null);

  const onDecide = async (item: LookupItem, status: Decision, reason: string, safety: boolean) => {
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
        safety: result.verificationStatus === 'rejected' && (result.agentsTakenDown ?? 0) > 0,
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
      const result = await loadFlagged();
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
    <div className="staff-repeat-infringers">
      <p>{t('intro')}</p>
      {error ? (
        <p role="alert" className="staff-repeat-infringers-error">
          {staffT(`errors.${error}`)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="staff-repeat-infringers-notice">
          {staffT(
            notice.status === 'verified'
              ? 'approved'
              : notice.safety
                ? 'rejectedSafety'
                : 'rejected',
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
        <ul className="staff-list" aria-label={t('title')}>
          {teachers.map((item) => (
            <VerificationRow
              key={item.teacherId}
              item={item}
              currentStatus={item.verificationStatus}
              pending={
                busy?.kind === 'decide' && busy.teacherId === item.teacherId ? busy.status : null
              }
              disabled={busy !== null}
              onDecide={(status, reason, safety) => void onDecide(item, status, reason, safety)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
