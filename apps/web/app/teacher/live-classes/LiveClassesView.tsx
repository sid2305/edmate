'use client';
// Task 11.1b Phase B: the teacher's live classes studio. A form schedules a class (title, an
// external join link, a start time, one checkbox per package); the list below shows the
// teacher's own scheduled classes, soonest first. Every fetch settles to a result; a failed call
// shows an error and re-enables the form (lessons: "a studio page that trusts a 200 response gets
// stuck" -- the body read is wrapped in try/catch, and the busy flag always clears in `finally`).
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ErrorCode } from '@edmate/contracts';
import type { TeacherLiveClassRow, TeacherQuestionGroup, TopicQuestionGroup } from '@edmate/db';
import { scheduleLiveClass, type ScheduleLiveClassResult } from '../../../src/studio/liveClasses/scheduleLiveClassAction';
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

export function LiveClassesView({
  classes: initialClasses,
  packages,
  studentQueue = [],
  askQueue = [],
  scheduleLiveClass: doSchedule = scheduleLiveClass,
}: LiveClassesViewProps) {
  const t = useTranslations('liveClassesStudio');
  const [classes, setClasses] = useState(initialClasses);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [packageIds, setPackageIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [notice, setNotice] = useState(false);

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
        [...cs, { id: result.id, title: title.trim(), link: link.trim(), startsAt: iso, packageIds }].sort(
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
              <span>{c.title}</span> <span>{c.startsAt}</span>{' '}
              <a href={c.link ?? undefined} target="_blank" rel="noopener noreferrer">
                {t('joinLink')}
              </a>
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
