'use client';
// Task 8.7 Phase D: the publish page. Shows the latest quality-gate run (idle, running, passed,
// failed, error), polls while a run is queued or running, and starts a new one. Every server
// reply goes through publishClient's zod parse; the start action is try/catch/finally with a busy
// flag; a start error is cleared at the next start and replaced (never merged) on each load
// (lessons: "UI state and server replies: trust neither, reset everything"). Error copy is a fixed
// message per code: never the server's text, an id or an error code.
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadLatestRun,
  startPublish,
  type PublishFailedCaseView,
  type PublishGroup,
  type PublishRun,
} from '../../../src/studio/publishClient';

const DEFAULT_POLL_MS = 5_000;

const GROUP_KEYS = [
  'leak',
  'locked',
  'safety-distress',
  'safety',
  'accuracy',
  'persona',
  'pedagogy',
  'advice',
  'grounding',
] as const;
const CHANGE_KEYS = [
  'first_publish',
  'prompt_pack_bump',
  'material',
  'packages',
  'style_card',
] as const;
const SCORECARD_KEYS = ['hints_before_answers', 'locked_content', 'accuracy'] as const;
const RUN_ERROR_KEYS = [
  'gate_unavailable',
  'stale',
  'enqueue_failed',
  'not_verified',
  'suspended',
  'regulated_unapproved',
] as const;
const START_ERROR_KEYS = [
  'not_verified',
  'no_packages',
  'style_card_required',
  'gate_running',
  'nothing_to_publish',
  'suspended',
  'regulated_unapproved',
  'conflict',
  'unavailable',
] as const;

type GroupKey = (typeof GROUP_KEYS)[number] | 'other';
type StartErrorKey = (typeof START_ERROR_KEYS)[number] | 'generic';

const pick = <K extends string>(keys: readonly K[], v: string | null | undefined): K | undefined =>
  (keys as readonly string[]).includes(v ?? '') ? (v as K) : undefined;
const groupKey = (g: string): GroupKey => pick(GROUP_KEYS, g) ?? 'other';

/** `2026-10-22 10:05 UTC`: the same text on every machine. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const isOpen = (run: PublishRun | null) => run?.status === 'queued' || run?.status === 'running';

export function PublishView({ pollMs = DEFAULT_POLL_MS }: { pollMs?: number }) {
  const t = useTranslations('publish');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const [run, setRun] = useState<PublishRun | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<StartErrorKey | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const r = await loadLatestRun();
      if (r.ok) {
        loaded.current = true;
        setRun(r.value.run);
        setSuspended(r.value.agentStatus === 'suspended');
        setLoadFailed(false);
        setPollFailed(false);
      } else if (loaded.current) {
        setPollFailed(true);
      } else {
        setLoadFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while the run is open; a failed poll keeps the last run and tries again.
  const open = isOpen(run);
  useEffect(() => {
    if (!open) return;
    // One poll in flight at a time, so a slow reply can never land after a newer one.
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void refresh().finally(() => {
        inFlight = false;
      });
    }, pollMs);
    return () => clearInterval(timer);
  }, [open, pollMs, refresh]);

  async function onPublish() {
    setBusy(true);
    setStartError(null);
    try {
      const r = await startPublish();
      if (!r.ok) {
        setStartError(pick(START_ERROR_KEYS, r.reason) ?? 'generic');
        return;
      }
      await refresh();
    } catch {
      setStartError('generic');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">{t('loading')}</p>;
  if (loadFailed) return <p role="alert">{t('loadError')}</p>;

  return (
    <div>
      <p>{t('intro')}</p>
      {suspended ? <p role="alert">{t('suspendedBanner')}</p> : null}
      {run === null ? <p>{t('idle')}</p> : <RunDetails run={run} />}
      {pollFailed ? <p role="status">{t('pollError')}</p> : null}
      {startError === null ? null : <p role="alert">{t(`startErrors.${startError}`)}</p>}
      <button type="button" onClick={() => void onPublish()} disabled={busy || open}>
        {busy ? t('starting') : run === null ? t('publishButton') : t('publishAgainButton')}
      </button>
    </div>
  );
}

function RunDetails({ run }: { run: PublishRun }) {
  const t = useTranslations('publish');
  const changes = run.changes.flatMap((c) => {
    const k = pick(CHANGE_KEYS, c);
    return k === undefined ? [] : [t(`changes.${k}`)];
  });
  return (
    <section aria-label={t('title')}>
      <StatusLine run={run} />
      {run.changedSincePublish ? <p role="status">{t('changedNote')}</p> : null}
      {changes.length === 0 ? null : (
        <>
          <p>{t('changesLabel')}</p>
          <ul>
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
      <p>{t('startedAt', { time: when(run.startedAt) })}</p>
      {run.finishedAt === null ? null : <p>{t('finishedAt', { time: when(run.finishedAt) })}</p>}
      {run.publishedAt === null ? null : <p>{t('publishedAt', { time: when(run.publishedAt) })}</p>}
      {run.status === 'passed' && run.scorecard !== null ? <Scorecard run={run} /> : null}
      {run.status === 'failed' ? <Failures groups={run.groups} cases={run.failedCases} /> : null}
    </section>
  );
}

function StatusLine({ run }: { run: PublishRun }) {
  const t = useTranslations('publish');
  switch (run.status) {
    case 'queued':
    case 'running':
      return <p role="status">{t('running')}</p>;
    case 'passed':
      return <p>{t('passed')}</p>;
    case 'failed':
      return <p>{t('failed')}</p>;
    case 'error': {
      const k = pick(RUN_ERROR_KEYS, run.errorCode) ?? 'generic';
      return (
        <>
          <p>{t('errorHeading')}</p>
          <p>{t(`runErrors.${k}`)}</p>
        </>
      );
    }
  }
}

function Scorecard({ run }: { run: PublishRun }) {
  const t = useTranslations('publish');
  const categories = run.scorecard?.categories ?? [];
  return (
    <section aria-label={t('scorecardHeading')}>
      <h2>{t('scorecardHeading')}</h2>
      <ul>
        {categories.flatMap((c) => {
          const k = pick(SCORECARD_KEYS, c.key);
          if (k === undefined) return [];
          const label = t(`scorecard.${k}`);
          return [
            <li key={k}>
              {c.measured && c.percent !== null
                ? t('scorecardLine', {
                    label,
                    passed: c.passed,
                    total: c.total,
                    percent: c.percent,
                  })
                : t('scorecardNotMeasured', { label })}
            </li>,
          ];
        })}
      </ul>
    </section>
  );
}

function Failures({ groups, cases }: { groups: PublishGroup[]; cases: PublishFailedCaseView[] }) {
  const t = useTranslations('publish');
  const failing = groups.filter((g) => !g.pass);
  const byGroup = new Map<GroupKey, PublishFailedCaseView[]>();
  for (const c of cases) {
    const k = groupKey(c.group);
    byGroup.set(k, [...(byGroup.get(k) ?? []), c]);
  }
  return (
    <>
      {failing.length === 0 ? null : (
        <section aria-label={t('groupsHeading')}>
          <h2>{t('groupsHeading')}</h2>
          <ul>
            {failing.map((g) => {
              const values = {
                group: t(`groups.${groupKey(g.group)}`),
                origin: t(`origins.${g.origin}`),
                passed: g.passed,
                total: g.total,
                minPercent: g.minPercent,
              };
              return (
                <li key={`${g.origin}-${g.group}`}>
                  {g.reason === 'empty_group' ? t('groupEmpty', values) : t('groupBelow', values)}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {cases.length === 0 ? null : (
        <section aria-label={t('failedHeading')}>
          <h2>{t('failedHeading')}</h2>
          {[...byGroup].map(([k, list]) => (
            <section key={k}>
              <h3>{t(`groups.${k}`)}</h3>
              <ul>
                {list.map((c) => (
                  <li key={c.caseId}>
                    <p>{t('caseId', { caseId: c.caseId })}</p>
                    {c.failedChecks.length === 0 ? null : (
                      <p>{t('caseWhy', { checks: c.failedChecks.join(', ') })}</p>
                    )}
                    {c.origin === 'agent' && c.question !== undefined ? (
                      <p>{t('caseQuestion', { question: c.question })}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      )}
    </>
  );
}
