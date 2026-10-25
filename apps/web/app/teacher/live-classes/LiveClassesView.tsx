'use client';
// Task 11.1b Phase B: the teacher's live classes studio. A form schedules a class (title, an
// external join link, a start time, one checkbox per package); the list below shows the
// teacher's own scheduled classes, soonest first. Every fetch settles to a result; a failed call
// shows an error and re-enables the form (lessons: "a studio page that trusts a 200 response gets
// stuck" -- the body read is wrapped in try/catch, and the busy flag always clears in `finally`).
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { ErrorCode } from '@edmate/contracts';
import type {
  LiveClassRecording,
  TeacherLiveClassRow,
  TeacherQuestionGroup,
  TopicQuestionGroup,
} from '@edmate/db';
import { listDocuments as defaultListDocuments } from '../../../src/studio/uploadClient';
import { RecordingUpload, type RecordingUploadProps } from './RecordingUpload';
import { scheduleLiveClass, type ScheduleLiveClassResult } from '../../../src/studio/liveClasses/scheduleLiveClassAction';
import { updateLiveClass as defaultUpdateLiveClass } from '../../../src/studio/liveClasses/updateLiveClassAction';
import { cancelLiveClass as defaultCancelLiveClass } from '../../../src/studio/liveClasses/cancelLiveClassAction';
import type { LiveClassesPackage } from '../../../src/studio/liveClasses/loadLiveClasses';

export interface LiveClassesViewProps {
  classes: TeacherLiveClassRow[];
  packages: LiveClassesPackage[];
  /** The student-fed pre-class queue, grouped by topic (task 11.2b). */
  studentQueue?: TopicQuestionGroup[];
  /** The teacher's whole open ask-the-teacher queue (5.10/8.9), shown as-is (lead answer Q2). */
  askQueue?: TeacherQuestionGroup[];
  /** Tests inject a fake; defaults to Phase B's route. */
  scheduleLiveClass?: typeof scheduleLiveClass;
  /** 11.1d Phase B: edits a scheduled class before it starts. Tests inject a fake. */
  updateLiveClass?: typeof defaultUpdateLiveClass;
  /** 11.1d Phase B: cancels (soft) a scheduled class. Tests inject a fake. */
  cancelLiveClass?: typeof defaultCancelLiveClass;
  /** 11.4c: the teacher's class recordings, shown under their own class. */
  recordings?: LiveClassRecording[];
  /** 11.4c: server time (ISO). A class with `startsAt <= now` can take a recording; none without it. */
  now?: string;
  /** 11.4c: the status poll's read; tests inject a fake (rule 4). */
  listDocuments?: typeof defaultListDocuments;
  /** 11.4c: the recording form's studio calls; tests inject fakes (rule 4). */
  recordingClient?: Pick<RecordingUploadProps, 'createDocument' | 'putFile' | 'completeDocument'>;
}

/** 11.4c: how often the class rows re-read recording statuses while one is pending. */
export const RECORDING_POLL_MS = 5000;

/** 11.4g (code/typescript-reviewer, MEDIUM): a stuck "uploading"/"processing" row (e.g. the
 * server's own processing step wedges) must not poll forever while the page stays open; stop
 * after about 10 minutes per page visit and tell the teacher to check back later. */
export const RECORDING_POLL_MAX_MS = 10 * 60 * 1000;

/** The poll's payload, checked before use; a bad one keeps the last good view (lessons). */
const PollSchema = z.array(
  z.object({
    id: z.string(),
    status: z.enum(['uploading', 'processing', 'ready', 'failed']),
    failureReason: z.string().optional(),
  }),
);

/** The upload centre's failure-reason keys (`uploads.reasons.*`); anything else is `other`. */
const REASON_KEYS = [
  'input_too_large',
  'unsupported_type',
  'unsupported',
  'forbidden',
  'enqueue_failed',
  'validation',
  'provider_error',
] as const;
function reasonKey(reason: string | undefined): (typeof REASON_KEYS)[number] | 'other' {
  return (REASON_KEYS as readonly string[]).includes(reason ?? '')
    ? (reason as (typeof REASON_KEYS)[number])
    : 'other';
}

const isPending = (r: LiveClassRecording) => r.status === 'uploading' || r.status === 'processing';

/** Upserts a recording by document id (newest first when new). */
function upsert(rows: LiveClassRecording[], row: LiveClassRecording): LiveClassRecording[] {
  return rows.some((r) => r.documentId === row.documentId)
    ? rows.map((r) => (r.documentId === row.documentId ? row : r))
    : [row, ...rows];
}

/** `oldestAt` is an ISO timestamp; shown as a plain date (English-only pilot, no locale lookup). */
function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

const ERROR_KEYS = ['validation', 'not_found'] as const;
type ErrorKey = (typeof ERROR_KEYS)[number] | 'generic';
function errorKey(code: ErrorCode): ErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(code) ? (code as ErrorKey) : 'generic';
}

/** A `datetime-local` value has no offset; this gives the route the offset it requires. */
function toIsoWithOffset(localValue: string): string | null {
  const ms = new Date(localValue).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** The reverse of `toIsoWithOffset`: an ISO timestamp as a local `datetime-local` value, for
 * pre-filling the edit form (11.1d Phase B). */
function toLocalInputValue(isoValue: string): string {
  const d = new Date(isoValue);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LiveClassesView({
  classes: initialClasses,
  packages,
  studentQueue = [],
  askQueue = [],
  scheduleLiveClass: doSchedule = scheduleLiveClass,
  updateLiveClass: doUpdate = defaultUpdateLiveClass,
  cancelLiveClass: doCancel = defaultCancelLiveClass,
  recordings: initialRecordings = [],
  now,
  listDocuments = defaultListDocuments,
  recordingClient = {},
}: LiveClassesViewProps) {
  const t = useTranslations('liveClassesStudio');
  const tu = useTranslations('uploads');
  const [recordings, setRecordings] = useState(initialRecordings);
  const [openClassId, setOpenClassId] = useState<string | null>(null);
  const [timedOutIds, setTimedOutIds] = useState<Set<string>>(new Set());
  const pending = recordings.some(isPending);
  // 11.4g fix round (code/typescript-reviewer, MEDIUM): the poll-cap clock is per row, keyed by
  // documentId, not one shared clock keyed off the `pending` boolean -- a row that is already
  // capped out must not block a newer row from getting its own full RECORDING_POLL_MAX_MS window.
  const recordingsRef = useRef(recordings);
  useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);
  const pollStart = useRef<Map<string, number>>(new Map());

  // 11.4c: while a shown recording is uploading or processing, re-read statuses every 5 s. Stops
  // when none is pending and on unmount. A failed or malformed read keeps the last good view and
  // the next tick tries again; one read at a time.
  // 11.4g: each pending row gets its own RECORDING_POLL_MAX_MS window from when it first appears;
  // polling keeps going as long as any row is still inside its window, even if another row has
  // already capped out.
  useEffect(() => {
    if (!pending) {
      pollStart.current.clear();
      setTimedOutIds(new Set());
      return undefined;
    }
    let alive = true;
    let inFlight = false;
    const sync = (): boolean => {
      const now = Date.now();
      const pendingIds = new Set(
        recordingsRef.current.filter(isPending).map((r) => r.documentId),
      );
      for (const id of pendingIds) {
        if (!pollStart.current.has(id)) pollStart.current.set(id, now);
      }
      for (const id of Array.from(pollStart.current.keys())) {
        if (!pendingIds.has(id)) pollStart.current.delete(id);
      }
      const timedOut = new Set<string>();
      for (const [id, startedAt] of pollStart.current) {
        if (now - startedAt >= RECORDING_POLL_MAX_MS) timedOut.add(id);
      }
      if (alive) setTimedOutIds(timedOut);
      return pendingIds.size > 0 && Array.from(pendingIds).every((id) => timedOut.has(id));
    };
    sync();
    const timer = setInterval(() => {
      // A row already past its own window is skipped, but the interval keeps running (not
      // cleared) so a later, still-fresh pending row still gets polled for its own full window.
      if (sync()) return;
      if (inFlight) return;
      inFlight = true;
      void (async () => {
        try {
          const result = await listDocuments();
          if (!alive || !result.ok) return;
          const parsed = PollSchema.safeParse(result.value);
          if (!parsed.success) return;
          const byId = new Map(parsed.data.map((d) => [d.id, d]));
          setRecordings((rows) =>
            rows.map((r) => {
              const d = byId.get(r.documentId);
              if (!d) return r;
              return {
                liveClassId: r.liveClassId,
                documentId: r.documentId,
                sourceTitle: r.sourceTitle,
                status: d.status,
                ...(d.status === 'failed' && d.failureReason !== undefined
                  ? { failureReason: d.failureReason }
                  : {}),
              };
            }),
          );
        } catch {
          // An unreadable reply: keep the last good view; the next tick retries.
        } finally {
          inFlight = false;
        }
      })();
    }, RECORDING_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pending, listDocuments]);

  /** The union of the class's attached packages' modules, in package order (Q4). */
  const modulesFor = (c: TeacherLiveClassRow): string[] => [
    ...new Set(packages.filter((p) => c.packageIds.includes(p.packageId)).flatMap((p) => p.moduleIds)),
  ];
  const hasStarted = (c: TeacherLiveClassRow) =>
    now !== undefined && new Date(c.startsAt).getTime() <= new Date(now).getTime();
  const [classes, setClasses] = useState(initialClasses);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [packageIds, setPackageIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [notice, setNotice] = useState(false);

  // 11.1d Phase B: edit/cancel state, per row (not the whole-page `busy`), so editing one class
  // never disables Save or Cancel on another (lessons: "a studio page that trusts a 200 response
  // gets stuck").
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ title: '', link: '', startsAt: '' });
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, ErrorKey | null>>({});
  // Tracks the live `editingId` for in-flight saveEdit calls: a discard clears `editingId`
  // immediately, but the async saveEdit closure only sees the value at call time, so without
  // this ref a stale PUT resolving after discard would still overwrite the row (code review
  // HIGH, 11.1d Phase B/C).
  const editingIdRef = useRef(editingId);
  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  const startEdit = (c: TeacherLiveClassRow) => {
    setEditingId(c.id);
    setEditDraft({
      title: c.title,
      link: c.link ?? '',
      startsAt: toLocalInputValue(c.startsAt),
    });
    setRowError((errs) => ({ ...errs, [c.id]: null }));
  };

  const cancelEditDraft = () => setEditingId(null);

  const saveEdit = async (c: TeacherLiveClassRow) => {
    const iso = toIsoWithOffset(editDraft.startsAt);
    if (!editDraft.title.trim() || !editDraft.link.trim() || !iso) {
      setRowError((errs) => ({ ...errs, [c.id]: 'validation' }));
      return;
    }
    setRowError((errs) => ({ ...errs, [c.id]: null }));
    setRowBusy((b) => ({ ...b, [c.id]: true }));
    try {
      const result = await doUpdate(c.id, {
        title: editDraft.title.trim(),
        link: editDraft.link.trim(),
        startsAt: iso,
      });
      if (!result.ok) {
        setRowError((errs) => ({ ...errs, [c.id]: errorKey(result.code) }));
        return;
      }
      // 11.1e Phase B fix (review MEDIUM): the server's successful save applies to `c`'s row
      // unconditionally -- it must not keep showing stale pre-edit values until reload, even
      // when another row's edit started (or this one was discarded) while the PUT was in
      // flight. Only closing the edit form (`setEditingId(null)`) is guarded: never close a
      // form the teacher didn't ask to close, and never clobber `editingId` if it now points at
      // a different row.
      setClasses((cs) =>
        cs.map((row) =>
          row.id === c.id
            ? { ...row, title: editDraft.title.trim(), link: editDraft.link.trim(), startsAt: iso }
            : row,
        ),
      );
      if (editingIdRef.current === c.id) {
        setEditingId(null);
      }
    } catch {
      setRowError((errs) => ({ ...errs, [c.id]: 'generic' }));
    } finally {
      setRowBusy((b) => ({ ...b, [c.id]: false }));
    }
  };

  const onCancelClass = async (c: TeacherLiveClassRow) => {
    if (!window.confirm(t('cancelConfirm'))) return;
    setRowError((errs) => ({ ...errs, [c.id]: null }));
    setRowBusy((b) => ({ ...b, [c.id]: true }));
    try {
      const result = await doCancel(c.id);
      if (!result.ok) {
        setRowError((errs) => ({ ...errs, [c.id]: errorKey(result.code) }));
        return;
      }
      setClasses((cs) =>
        cs.map((row) => (row.id === c.id ? { ...row, status: 'cancelled' as const } : row)),
      );
    } catch {
      setRowError((errs) => ({ ...errs, [c.id]: 'generic' }));
    } finally {
      setRowBusy((b) => ({ ...b, [c.id]: false }));
    }
  };

  const togglePackage = (packageId: string) =>
    setPackageIds((ids) =>
      ids.includes(packageId) ? ids.filter((id) => id !== packageId) : [...ids, packageId],
    );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const iso = toIsoWithOffset(startsAt);
    if (!title.trim() || !link.trim() || !iso || packageIds.length === 0) {
      setError('validation');
      return;
    }
    setError(null);
    setNotice(false);
    setBusy(true);
    try {
      const result: ScheduleLiveClassResult = await doSchedule({
        title: title.trim(),
        link: link.trim(),
        startsAt: iso,
        packageIds,
      });
      if (!result.ok) {
        setError(errorKey(result.code));
        return;
      }
      setClasses((cs) =>
        [...cs, { id: result.id, title: title.trim(), link: link.trim(), startsAt: iso, packageIds, status: 'scheduled' as const }].sort(
          (a, b) => a.startsAt.localeCompare(b.startsAt),
        ),
      );
      setTitle('');
      setLink('');
      setStartsAt('');
      setPackageIds([]);
      setNotice(true);
    } catch {
      setError('generic');
    } finally {
      setBusy(false);
    }
  };

  const renderRecordings = (c: TeacherLiveClassRow) => {
    const rows = recordings.filter((r) => r.liveClassId === c.id);
    if (rows.length === 0) return null;
    return (
      <ul aria-label={t('recording.listLabel', { title: c.title })}>
        {rows.map((r) => (
          <li key={r.documentId}>
            <span>{r.sourceTitle}</span> <span>{tu(`status.${r.status}`)}</span>
            {r.status === 'failed' ? <span> {tu(`reasons.${reasonKey(r.failureReason)}`)}</span> : null}
            {isPending(r) && timedOutIds.has(r.documentId) ? <span> {tu('pollTimeout')}</span> : null}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="live-classes-studio">
      <p>{t('intro')}</p>
      {error ? (
        <p role="alert" className="live-classes-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="live-classes-notice">
          {t('scheduled')}
        </p>
      ) : null}
      <form onSubmit={(e) => void onSubmit(e)}>
        <p>
          <label htmlFor="live-class-title">{t('titleLabel')}</label>
          <input id="live-class-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </p>
        <p>
          <label htmlFor="live-class-link">{t('linkLabel')}</label>
          <input id="live-class-link" value={link} onChange={(e) => setLink(e.target.value)} />
        </p>
        <p>
          <label htmlFor="live-class-starts-at">{t('startsAtLabel')}</label>
          <input
            id="live-class-starts-at"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </p>
        <fieldset>
          <legend>{t('packagesLabel')}</legend>
          {packages.map((p) => (
            <p key={p.packageId}>
              <label>
                <input
                  type="checkbox"
                  checked={packageIds.includes(p.packageId)}
                  onChange={() => togglePackage(p.packageId)}
                />
                {p.name}
              </label>
            </p>
          ))}
        </fieldset>
        <button type="submit" disabled={busy}>
          {busy ? t('scheduling') : t('scheduleButton')}
        </button>
      </form>
      {classes.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ul aria-label={t('title')}>
          {classes.map((c) => (
            <li key={c.id}>
              {rowError[c.id] ? (
                <p role="alert" className="live-classes-row-error">
                  {t(`errors.${rowError[c.id]}`)}
                </p>
              ) : null}
              {editingId === c.id ? (
                <>
                  <p>
                    <label htmlFor={`live-class-edit-title-${c.id}`}>{t('editTitleLabel')}</label>
                    <input
                      id={`live-class-edit-title-${c.id}`}
                      value={editDraft.title}
                      onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                    />
                  </p>
                  <p>
                    <label htmlFor={`live-class-edit-link-${c.id}`}>{t('editLinkLabel')}</label>
                    <input
                      id={`live-class-edit-link-${c.id}`}
                      value={editDraft.link}
                      onChange={(e) => setEditDraft((d) => ({ ...d, link: e.target.value }))}
                    />
                  </p>
                  <p>
                    <label htmlFor={`live-class-edit-starts-at-${c.id}`}>
                      {t('editStartsAtLabel')}
                    </label>
                    <input
                      id={`live-class-edit-starts-at-${c.id}`}
                      type="datetime-local"
                      value={editDraft.startsAt}
                      onChange={(e) => setEditDraft((d) => ({ ...d, startsAt: e.target.value }))}
                    />
                  </p>
                  <button type="button" disabled={!!rowBusy[c.id]} onClick={() => void saveEdit(c)}>
                    {rowBusy[c.id] ? t('saving') : t('saveButton')}
                  </button>{' '}
                  <button type="button" disabled={!!rowBusy[c.id]} onClick={cancelEditDraft}>
                    {t('cancelEditButton')}
                  </button>
                </>
              ) : (
                <>
                  <span>{c.title}</span> <span>{c.startsAt}</span>{' '}
                  {c.status === 'cancelled' ? (
                    <span>{t('cancelledLabel')}</span>
                  ) : (
                    <a
                      href={c.link ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('joinLinkLabel', { title: c.title })}
                    >
                      {t('joinLink')}
                    </a>
                  )}
                  {renderRecordings(c)}
                  {c.status === 'scheduled' && !hasStarted(c) ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        disabled={!!rowBusy[c.id]}
                        aria-label={t('editButtonLabel', { title: c.title })}
                        onClick={() => startEdit(c)}
                      >
                        {t('editButton')}
                      </button>{' '}
                      <button
                        type="button"
                        disabled={!!rowBusy[c.id]}
                        aria-label={t('cancelButtonLabel', { title: c.title })}
                        onClick={() => void onCancelClass(c)}
                      >
                        {rowBusy[c.id] ? t('cancelling') : t('cancelButton')}
                      </button>
                    </>
                  ) : null}
                  {hasStarted(c) ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        aria-expanded={openClassId === c.id}
                        aria-label={t('recording.addLabel', { title: c.title })}
                        onClick={() => setOpenClassId((id) => (id === c.id ? null : c.id))}
                      >
                        {openClassId === c.id ? t('recording.close') : t('recording.add')}
                      </button>
                      {openClassId === c.id ? (
                        <RecordingUpload
                          liveClass={c}
                          moduleIds={modulesFor(c)}
                          onRecording={(row) => setRecordings((rows) => upsert(rows, row))}
                          {...recordingClient}
                        />
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="student-queue-title">
        <h2 id="student-queue-title">{t('studentQueue.title')}</h2>
        {studentQueue.length === 0 ? (
          <p>{t('studentQueue.empty')}</p>
        ) : (
          <ul aria-label={t('studentQueue.title')}>
            {studentQueue.map((g) => (
              <li key={g.groupId}>
                <p>{t('studentQueue.since', { count: g.count, date: formatDate(g.oldestAt) })}</p>
                {/* Student text only, never HTML: a rendered `{g.sample}` is plain React text --
                    no raw-HTML render, no markdown-to-HTML pass (11.2a review, LOW; see
                    src/chat/no-raw-html.test.ts for the banned-API sweep this file is under). */}
                <p>{g.sample}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="ask-queue-title">
        <h2 id="ask-queue-title">{t('askQueue.title')}</h2>
        {askQueue.length === 0 ? (
          <p>{t('askQueue.empty')}</p>
        ) : (
          <ul aria-label={t('askQueue.title')}>
            {askQueue.map((g) => (
              <li key={g.groupId}>
                <p>{t('studentQueue.since', { count: g.count, date: formatDate(g.oldestAt) })}</p>
                <p>{g.questions[0]?.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
