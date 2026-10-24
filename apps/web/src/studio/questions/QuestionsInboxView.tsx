'use client';
// Task 8.9 Phase C: the teacher questions inbox. One card per group (count, oldest date, every
// member's question text -- no student name, id or email anywhere, per 5.10's repository).
// Each question row can be dismissed on its own (plan Q1: single-row only); the group's shared
// module picker and answer textarea send one answer to the whole group (5.10's group-wide write).
// Every fetch settles to a result; a failed call shows an error and re-enables the buttons
// (lessons: "a studio page that trusts a 200 response gets stuck").
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ErrorCode } from '@edmate/contracts';
import { answerGroup, dismissQuestion } from './sendQuestionAction';

export interface InboxQuestion {
  id: string;
  text: string;
  createdAt: string;
}

export interface InboxGroup {
  groupId: string;
  count: number;
  oldestAt: string;
  questions: InboxQuestion[];
}

export interface InboxModule {
  id: string;
  title: string;
}

export interface QuestionsInboxViewProps {
  groups: InboxGroup[];
  modules: InboxModule[];
  /** Tests inject fakes; defaults POST to Phase B's routes. */
  answerGroup?: typeof answerGroup;
  dismissQuestion?: typeof dismissQuestion;
}

type Busy = { groupId: string; kind: 'answer' } | { questionId: string; kind: 'dismiss' } | null;

const ERROR_KEYS = ['validation', 'not_found'] as const;
type ErrorKey = (typeof ERROR_KEYS)[number] | 'generic';
function errorKey(code: ErrorCode): ErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(code) ? (code as ErrorKey) : 'generic';
}

export function QuestionsInboxView({
  groups: initialGroups,
  modules,
  answerGroup: doAnswer = answerGroup,
  dismissQuestion: doDismiss = dismissQuestion,
}: QuestionsInboxViewProps) {
  const t = useTranslations('questionsInbox');
  // `groups`/`moduleId` are seeded once from props and never resynced against a later prop
  // change: this view is only ever mounted fresh per server-rendered page load (8.9c review),
  // so a prop update after mount cannot happen today. If this view is ever reused across a
  // prop change (for example, kept mounted across client-side navigation), resync both here.
  const [groups, setGroups] = useState(initialGroups);
  const [moduleId, setModuleId] = useState<Record<string, string>>(
    () => Object.fromEntries(initialGroups.map((g) => [g.groupId, modules[0]?.id ?? ''])),
  );
  const [answerText, setAnswerText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [notice, setNotice] = useState<'answered' | 'dismissed' | null>(null);

  const removeGroup = (groupId: string) => setGroups((gs) => gs.filter((g) => g.groupId !== groupId));

  const removeQuestion = (groupId: string, questionId: string) =>
    setGroups((gs) =>
      gs
        .map((g) =>
          g.groupId === groupId
            ? { ...g, questions: g.questions.filter((q) => q.id !== questionId) }
            : g,
        )
        .filter((g) => g.questions.length > 0),
    );

  const onAnswer = async (group: InboxGroup) => {
    const picked = moduleId[group.groupId];
    const answer = (answerText[group.groupId] ?? '').trim();
    if (!picked || !answer) return setError('validation');
    setError(null);
    setNotice(null);
    setBusy({ groupId: group.groupId, kind: 'answer' });
    try {
      const result = await doAnswer({
        questionId: group.questions[0]?.id ?? group.groupId,
        moduleId: picked,
        answer,
      });
      if (!result.ok) {
        setError(errorKey(result.code));
        return;
      }
      removeGroup(group.groupId);
      setNotice('answered');
    } catch {
      // Defence in depth (8.9c review): `answerGroup` already settles to a result and never
      // rejects, but an injected action in a future caller might; never leave an unhandled
      // rejection, show the same error banner instead.
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  const onDismiss = async (group: InboxGroup, questionId: string) => {
    setError(null);
    setNotice(null);
    setBusy({ questionId, kind: 'dismiss' });
    try {
      const result = await doDismiss(questionId);
      if (!result.ok) {
        setError(errorKey(result.code));
        return;
      }
      removeQuestion(group.groupId, questionId);
      setNotice('dismissed');
    } catch {
      // Defence in depth (8.9c review): same as `onAnswer` above.
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="questions-inbox">
      <p>{t('intro')}</p>
      {error ? (
        <p role="alert" className="questions-inbox-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="questions-inbox-notice">
          {t(notice)}
        </p>
      ) : null}
      {groups.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ul className="questions-inbox-list" aria-label={t('title')}>
          {groups.map((group) => {
            const answering = busy?.kind === 'answer' && busy.groupId === group.groupId;
            return (
              <li key={group.groupId} className="questions-inbox-card">
                <p className="questions-inbox-count">{t('countLabel', { count: group.count })}</p>
                <ul>
                  {group.questions.map((q) => {
                    const dismissing = busy?.kind === 'dismiss' && busy.questionId === q.id;
                    return (
                      <li key={q.id} className="questions-inbox-question">
                        <span>{q.text}</span>
                        <button
                          type="button"
                          disabled={dismissing}
                          onClick={() => void onDismiss(group, q.id)}
                        >
                          {dismissing ? t('dismissing') : t('dismissButton')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="questions-inbox-field">
                  <label htmlFor={`questions-inbox-module-${group.groupId}`}>{t('moduleLabel')}</label>
                  <select
                    id={`questions-inbox-module-${group.groupId}`}
                    value={moduleId[group.groupId] ?? ''}
                    onChange={(e) =>
                      setModuleId((m) => ({ ...m, [group.groupId]: e.target.value }))
                    }
                  >
                    {modules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                </p>
                <p className="questions-inbox-field">
                  <label htmlFor={`questions-inbox-answer-${group.groupId}`}>{t('answerLabel')}</label>
                  <textarea
                    id={`questions-inbox-answer-${group.groupId}`}
                    value={answerText[group.groupId] ?? ''}
                    onChange={(e) =>
                      setAnswerText((a) => ({ ...a, [group.groupId]: e.target.value }))
                    }
                  />
                </p>
                <button type="button" disabled={answering} onClick={() => void onAnswer(group)}>
                  {answering ? t('sending') : t('sendButton')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
