'use client';
// Task 8.3 Phase C: the teacher's outline editor. Fetches the outline on mount; lets the teacher
// rename and reorder modules and topics, merge or split topics, generate a fresh outline from
// uploads (with a confirm before it overwrites unsaved edits), and save the whole edited tree
// back. Every string is from messages/en.json; titles render as text, never as markup (React
// escapes by default). Follows UploadsView.tsx's local-state/translation patterns.
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  generateOutline,
  getOutline,
  putOutline,
  type ApiResult,
  type OutlineInput,
  type OutlineModule,
  type OutlineSource,
} from '../../../src/studio/outlineClient';

/** A topic, keyed for React/selection by `tempId`: an existing topic's own id, or a client-only
 * id for a topic a split created that has not been saved yet (so `id` stays absent in the `PUT`). */
interface LocalTopic {
  tempId: string;
  id?: string;
  title: string;
  order: number;
  chunkIds: OutlineSource[];
}

interface LocalModule {
  id: string;
  title: string;
  order: number;
  topics: LocalTopic[];
}

const ERROR_KEYS = [
  'validation',
  'not_found',
  'unauthorized',
  'forbidden',
  'rate_limited',
  'provider_error',
] as const;
type ErrorKey = (typeof ERROR_KEYS)[number];

function errorKey(result: Extract<ApiResult<unknown>, { ok: false }>): ErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(result.code)
    ? (result.code as ErrorKey)
    : 'provider_error';
}

function toLocalModules(modules: readonly OutlineModule[]): LocalModule[] {
  return modules.map((m) => ({
    id: m.id,
    title: m.title,
    order: m.order,
    topics: m.topics.map((t) => ({
      tempId: t.id,
      id: t.id,
      title: t.title,
      order: t.order,
      chunkIds: t.chunkIds,
    })),
  }));
}

function toInput(modules: readonly LocalModule[]): OutlineInput {
  return {
    modules: modules.map((m) => ({
      id: m.id,
      title: m.title,
      order: m.order,
      topics: m.topics.map((t) => ({
        ...(t.id ? { id: t.id } : {}),
        title: t.title,
        order: t.order,
        chunkIds: t.chunkIds.map((c) => c.chunkId),
      })),
    })),
  };
}

/** Swaps two rows and their `order` fields, so the written order always matches what is shown. */
function swapOrdered<T extends { order: number }>(rows: readonly T[], i: number, j: number): T[] {
  const next = [...rows];
  const orderI = rows[i]!.order;
  const orderJ = rows[j]!.order;
  next[i] = { ...rows[j]!, order: orderI };
  next[j] = { ...rows[i]!, order: orderJ };
  return next;
}

export function OutlineView() {
  const t = useTranslations('outline');
  const [modules, setModules] = useState<LocalModule[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [banner, setBanner] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Record<string, boolean>>({});
  const [splitSelected, setSplitSelected] = useState<Record<string, Record<string, boolean>>>({});
  const [splitTitle, setSplitTitle] = useState<Record<string, string>>({});
  const nextTemp = useRef(0);

  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const result = await getOutline();
        if (ignore) return;
        if (result.ok) setModules(toLocalModules(result.value.modules));
        else setBanner(errorKey(result));
      } catch {
        if (!ignore) setBanner('provider_error');
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const renameModule = (id: string, title: string) => {
    setModules((prev) => prev && prev.map((m) => (m.id === id ? { ...m, title } : m)));
    setDirty(true);
  };

  const renameTopic = (moduleId: string, tempId: string, title: string) => {
    setModules(
      (prev) =>
        prev &&
        prev.map((m) =>
          m.id !== moduleId
            ? m
            : { ...m, topics: m.topics.map((x) => (x.tempId === tempId ? { ...x, title } : x)) },
        ),
    );
    setDirty(true);
  };

  const moveModule = (index: number, dir: -1 | 1) => {
    setModules((prev) => {
      if (!prev) return prev;
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      return swapOrdered(prev, index, j);
    });
    setDirty(true);
  };

  const moveTopic = (moduleId: string, index: number, dir: -1 | 1) => {
    setModules((prev) => {
      if (!prev) return prev;
      return prev.map((m) => {
        if (m.id !== moduleId) return m;
        const j = index + dir;
        if (j < 0 || j >= m.topics.length) return m;
        return { ...m, topics: swapOrdered(m.topics, index, j) };
      });
    });
    setDirty(true);
  };

  const onMerge = (moduleId: string) => {
    setModules((prev) => {
      if (!prev) return prev;
      return prev.map((m) => {
        if (m.id !== moduleId) return m;
        const selected = m.topics.filter((x) => mergeSelected[x.tempId]);
        if (selected.length < 2) return m;
        const keep = selected[0]!;
        const bySource = new Map<string, OutlineSource>();
        for (const topic of selected) {
          for (const source of topic.chunkIds) bySource.set(source.chunkId, source);
        }
        const mergedChunkIds = [...bySource.values()];
        const selectedIds = new Set(selected.map((x) => x.tempId));
        const topics = m.topics
          .filter((x) => !selectedIds.has(x.tempId) || x.tempId === keep.tempId)
          .map((x) => (x.tempId === keep.tempId ? { ...x, chunkIds: mergedChunkIds } : x));
        return { ...m, topics };
      });
    });
    setMergeSelected({});
    setDirty(true);
  };

  const onSplit = (moduleId: string, tempId: string) => {
    const title = (splitTitle[tempId] ?? '').trim();
    const selected = splitSelected[tempId] ?? {};
    const selectedChunkIds = Object.keys(selected).filter((id) => selected[id]);
    if (!title || selectedChunkIds.length === 0) return;
    setModules((prev) => {
      if (!prev) return prev;
      return prev.map((m) => {
        if (m.id !== moduleId) return m;
        const topic = m.topics.find((x) => x.tempId === tempId);
        if (!topic) return m;
        const selectedSet = new Set(selectedChunkIds);
        const moved = topic.chunkIds.filter((c) => selectedSet.has(c.chunkId));
        const kept = topic.chunkIds.filter((c) => !selectedSet.has(c.chunkId));
        const maxOrder = m.topics.reduce((max, x) => Math.max(max, x.order), -1);
        const created: LocalTopic = {
          tempId: `tmp_${nextTemp.current++}`,
          title,
          order: maxOrder + 1,
          chunkIds: moved,
        };
        const topics = m.topics.map((x) => (x.tempId === tempId ? { ...x, chunkIds: kept } : x));
        return { ...m, topics: [...topics, created] };
      });
    });
    setSplitSelected((prev) => ({ ...prev, [tempId]: {} }));
    setSplitTitle((prev) => ({ ...prev, [tempId]: '' }));
    setDirty(true);
  };

  const onSave = useCallback(async () => {
    if (!modules) return;
    setBanner(null);
    setBusy(true);
    try {
      const result = await putOutline(toInput(modules));
      if (result.ok) {
        setModules(toLocalModules(result.value.modules));
        setSaved(result.value.outlineVersion);
        setDirty(false);
      } else {
        setBanner(errorKey(result));
      }
    } catch {
      setBanner('provider_error');
    } finally {
      setBusy(false);
    }
  }, [modules]);

  const doGenerate = useCallback(async () => {
    setConfirmGenerate(false);
    setBanner(null);
    setBusy(true);
    try {
      const result = await generateOutline();
      if (result.ok) {
        setModules(toLocalModules(result.value.modules));
        setSaved(null);
        setDirty(false);
      } else {
        setBanner(errorKey(result));
      }
    } catch {
      setBanner('provider_error');
    } finally {
      setBusy(false);
    }
  }, []);

  const onGenerateClick = () => {
    if (dirty) setConfirmGenerate(true);
    else void doGenerate();
  };

  return (
    <div className="outline">
      <p>{t('intro')}</p>
      {banner ? (
        <p role="alert" className="outline-error">
          {t(`errors.${banner}`)}
        </p>
      ) : null}
      {modules === null ? (
        <p>{t('loading')}</p>
      ) : modules.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        modules.map((m, mi) => (
          <section key={m.id} aria-label={m.title} className="outline-module">
            <p className="outline-field">
              <label htmlFor={`module-title-${m.id}`}>{t('moduleTitleLabel')}</label>
              <input
                id={`module-title-${m.id}`}
                value={m.title}
                onChange={(e) => renameModule(m.id, e.target.value)}
              />
              <button
                type="button"
                aria-label={t('moveUpLabel', { title: m.title })}
                disabled={mi === 0}
                onClick={() => moveModule(mi, -1)}
              >
                {t('moveUp')}
              </button>
              <button
                type="button"
                aria-label={t('moveDownLabel', { title: m.title })}
                disabled={mi === modules.length - 1}
                onClick={() => moveModule(mi, 1)}
              >
                {t('moveDown')}
              </button>
            </p>
            {m.topics.length === 0 ? (
              <p>{t('noTopics')}</p>
            ) : (
              <ul className="outline-topics">
                {m.topics.map((topic, ti) => (
                  <li key={topic.tempId} className="outline-topic">
                    <p className="outline-field">
                      <label htmlFor={`merge-${topic.tempId}`}>
                        {t('selectForMerge', { title: topic.title })}
                      </label>
                      <input
                        id={`merge-${topic.tempId}`}
                        type="checkbox"
                        checked={!!mergeSelected[topic.tempId]}
                        onChange={(e) =>
                          setMergeSelected((prev) => ({
                            ...prev,
                            [topic.tempId]: e.target.checked,
                          }))
                        }
                      />
                    </p>
                    <p className="outline-field">
                      <label htmlFor={`topic-title-${topic.tempId}`}>{t('topicTitleLabel')}</label>
                      <input
                        id={`topic-title-${topic.tempId}`}
                        value={topic.title}
                        onChange={(e) => renameTopic(m.id, topic.tempId, e.target.value)}
                      />
                      <button
                        type="button"
                        aria-label={t('moveUpLabel', { title: topic.title })}
                        disabled={ti === 0}
                        onClick={() => moveTopic(m.id, ti, -1)}
                      >
                        {t('moveUp')}
                      </button>
                      <button
                        type="button"
                        aria-label={t('moveDownLabel', { title: topic.title })}
                        disabled={ti === m.topics.length - 1}
                        onClick={() => moveTopic(m.id, ti, 1)}
                      >
                        {t('moveDown')}
                      </button>
                    </p>
                    <p>{t('sources')}</p>
                    {topic.chunkIds.length === 0 ? (
                      <p>{t('sourcesEmpty')}</p>
                    ) : (
                      <ul aria-label={t('sources')}>
                        {topic.chunkIds.map((source) => (
                          <li key={source.chunkId}>
                            <label htmlFor={`split-${topic.tempId}-${source.chunkId}`}>
                              {t('selectForSplit', { sourceTitle: source.sourceTitle })} (
                              {source.locator})
                            </label>
                            <input
                              id={`split-${topic.tempId}-${source.chunkId}`}
                              type="checkbox"
                              checked={!!splitSelected[topic.tempId]?.[source.chunkId]}
                              onChange={(e) =>
                                setSplitSelected((prev) => ({
                                  ...prev,
                                  [topic.tempId]: {
                                    ...prev[topic.tempId],
                                    [source.chunkId]: e.target.checked,
                                  },
                                }))
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="outline-field">
                      <label htmlFor={`split-title-${topic.tempId}`}>
                        {t('newTopicTitleLabel')}
                      </label>
                      <input
                        id={`split-title-${topic.tempId}`}
                        value={splitTitle[topic.tempId] ?? ''}
                        placeholder={t('newTopicTitlePlaceholder')}
                        onChange={(e) =>
                          setSplitTitle((prev) => ({ ...prev, [topic.tempId]: e.target.value }))
                        }
                      />
                      <button type="button" onClick={() => onSplit(m.id, topic.tempId)}>
                        {t('split')}
                      </button>
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => onMerge(m.id)}>
              {t('mergeSelected')}
            </button>
          </section>
        ))
      )}
      <p className="outline-actions">
        <button type="button" onClick={onGenerateClick} disabled={modules === null || busy}>
          {t('generate')}
        </button>
        <button type="button" onClick={() => void onSave()} disabled={modules === null || busy}>
          {t('save')}
        </button>
      </p>
      {saved !== null ? <p aria-live="polite">{t('saved', { version: saved })}</p> : null}
      {confirmGenerate ? (
        <p role="alert" className="outline-confirm">
          {t('generateConfirmBody')}
          <button type="button" onClick={() => void doGenerate()}>
            {t('generateConfirm')}
          </button>
          <button type="button" onClick={() => setConfirmGenerate(false)}>
            {t('cancel')}
          </button>
        </p>
      ) : null}
    </div>
  );
}
