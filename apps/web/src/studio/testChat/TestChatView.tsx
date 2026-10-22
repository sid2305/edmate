'use client';
// Task 8.5 Phase C: the teacher's test chat. The teacher picks one of the agent's packages and
// chats as a student on it would; a "Mark wrong" action under each finished agent reply opens an
// inline correction form (module, the student's question, the agent's answer, the correct answer)
// that POSTs to /api/studio/corrections.
// - The turn semantics are the student chat's: the same `reduceTurn` reducer, `MessageBubble`,
//   `Composer` and `SourcesList` (read-only imports from src/chat). A streaming reply is
//   provisional and outside the live thread; an error drops it and shows fixed text with a retry
//   when retryable.
// - Switching package aborts the turn, clears the thread and starts a new preview session on the
//   next send. Each page load starts a fresh session (no `?s=` reopen in v1).
// - Every async action settles: start/correction failures show an error, and the correction
//   form's busy flag is cleared in `finally` (lessons: "a studio page that trusts a 200").
import { LIMITS } from '@edmate/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useReducer, useRef, useState, type FormEvent } from 'react';
import { Composer } from '../../chat/Composer';
import { HintButton } from '../../chat/HintButton';
import { LockedNotice } from '../../chat/LockedNotice';
import { MessageBubble } from '../../chat/MessageBubble';
import type { TurnHandle } from '../../chat/sendTurn';
import { SkillCard } from '../../chat/SkillCard';
import { SourcesList } from '../../chat/SourcesList';
import { TeacherQuestionNotice } from '../../chat/TeacherQuestionNotice';
import { initialTurn, reduceTurn, type StreamItem, type TurnView } from '../../chat/turnState';
import type { ClientTurn } from '../../turn/clientInput';
import type { TestChatModule } from './loadTestChat';
import {
  sendTestTurn as realSend,
  startTestSession as realStart,
  submitCorrection as realCorrect,
  type CorrectionResult,
} from './sendTestTurn';

export interface TestChatPackage {
  packageId: string;
  name: string;
}

export interface TestChatViewProps {
  agentId: string;
  /** Non-empty: the page shows its own empty state when the agent has no package to test. */
  packages: readonly TestChatPackage[];
  modules: readonly TestChatModule[];
  /** Injected in tests; the real fetch-based clients otherwise. */
  start?: typeof realStart;
  send?: typeof realSend;
  correct?: typeof realCorrect;
  now?: () => Date;
}

type TurnRequest = Pick<ClientTurn, 'kind' | 'text'>;
type ChatAction = StreamItem | { kind: 'reset' };

function chatTurn(state: TurnView, action: ChatAction): TurnView {
  return action.kind === 'reset' ? initialTurn() : reduceTurn(state, action);
}

/** A thread entry. An agent reply carries its turn and the student text it answered. */
type ThreadItem =
  | { key: string; role: 'student'; text: string }
  | { key: string; role: 'agent'; text: string; turn: TurnView; question: string };

function TurnExtras({ turn }: { turn: TurnView }) {
  return (
    <>
      {turn.skills.map((s, i) => (
        <SkillCard key={i} skill={s.skill} />
      ))}
      {turn.locked === null ? null : <LockedNotice {...turn.locked} />}
      {turn.teacherQuestionId === null ? null : <TeacherQuestionNotice />}
      <SourcesList items={turn.sources} />
    </>
  );
}

type FormStatus = { kind: 'idle' } | { kind: 'error'; text: string };

interface CorrectionFormProps {
  modules: readonly TestChatModule[];
  question: string;
  badAnswer: string;
  correct: typeof realCorrect;
  onSaved(): void;
  onCancel(): void;
}

function errorKey(result: CorrectionResult): 'validation' | 'not_found' | 'generic' {
  if (result.ok) return 'generic';
  return result.code === 'validation' || result.code === 'not_found' ? result.code : 'generic';
}

function CorrectionForm({ modules, question: initialQuestion, badAnswer, correct, onSaved, onCancel }: CorrectionFormProps) {
  const t = useTranslations('testChat');
  const id = useId();
  const [moduleId, setModuleId] = useState(modules[0]?.id ?? '');
  const [question, setQuestion] = useState(initialQuestion);
  const [corrected, setCorrected] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FormStatus>({ kind: 'idle' });

  const ready = moduleId !== '' && question.trim() !== '' && corrected.trim() !== '' && !busy;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setStatus({ kind: 'idle' });
    try {
      const result = await correct({
        moduleId,
        question: question.trim(),
        badAnswer,
        correctedAnswer: corrected.trim(),
      });
      if (result.ok) {
        onSaved();
        return;
      }
      setStatus({ kind: 'error', text: t(`errors.${errorKey(result)}`) });
    } catch {
      setStatus({ kind: 'error', text: t('errors.generic') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="test-chat-correction" aria-label={t('correctionTitle')} onSubmit={(e) => void onSubmit(e)}>
      <p className="test-chat-correction-title">{t('correctionTitle')}</p>
      {modules.length === 0 ? (
        <p className="chat-notice">{t('noModules')}</p>
      ) : (
        <>
          <label htmlFor={`${id}-module`}>{t('moduleLabel')}</label>
          <select id={`${id}-module`} value={moduleId} disabled={busy} onChange={(e) => setModuleId(e.target.value)}>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor={`${id}-question`}>{t('questionLabel')}</label>
      <textarea
        id={`${id}-question`}
        rows={2}
        value={question}
        maxLength={LIMITS.turnTextMaxLength}
        disabled={busy}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <p className="test-chat-correction-label">{t('badAnswerLabel')}</p>
      <blockquote className="test-chat-bad-answer">{badAnswer}</blockquote>
      <label htmlFor={`${id}-corrected`}>{t('correctedLabel')}</label>
      <textarea
        id={`${id}-corrected`}
        rows={4}
        value={corrected}
        maxLength={LIMITS.turnTextMaxLength}
        disabled={busy}
        onChange={(e) => setCorrected(e.target.value)}
      />
      {status.kind === 'error' ? (
        <p className="chat-error" role="alert">
          {status.text}
        </p>
      ) : null}
      <div className="test-chat-correction-actions">
        <button type="submit" disabled={!ready}>
          {busy ? t('saving') : t('submit')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

interface ReplyActionsProps {
  replyKey: string;
  question: string;
  answer: string;
  open: string | null;
  saved: ReadonlySet<string>;
  modules: readonly TestChatModule[];
  correct: typeof realCorrect;
  setOpen(key: string | null): void;
  markSaved(key: string): void;
}

function ReplyActions({ replyKey, question, answer, open, saved, modules, correct, setOpen, markSaved }: ReplyActionsProps) {
  const t = useTranslations('testChat');
  if (answer === '') return null;
  const isOpen = open === replyKey;
  return (
    <div className="test-chat-reply-actions">
      {saved.has(replyKey) ? (
        <p className="chat-notice" role="status">
          {t('saved')}
        </p>
      ) : null}
      {isOpen ? (
        <CorrectionForm
          modules={modules}
          question={question}
          badAnswer={answer}
          correct={correct}
          onSaved={() => {
            markSaved(replyKey);
            setOpen(null);
          }}
          onCancel={() => setOpen(null)}
        />
      ) : (
        <button type="button" aria-expanded={false} onClick={() => setOpen(replyKey)}>
          {t('markWrong')}
        </button>
      )}
    </div>
  );
}

export function TestChatView({
  agentId,
  packages,
  modules,
  start = realStart,
  send = realSend,
  correct = realCorrect,
  now = () => new Date(),
}: TestChatViewProps) {
  const t = useTranslations('testChat');
  const chat = useTranslations('chat');
  const pickerId = useId();
  const [packageId, setPackageId] = useState(packages[0]?.packageId ?? '');
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [turn, dispatch] = useReducer(chatTurn, undefined, initialTurn);
  const [active, setActive] = useState(false);
  const [lastRequest, setLastRequest] = useState<TurnRequest | null>(null);
  /** The current turn's thread key and the student text it answers (the form's question). */
  const [reply, setReply] = useState({ key: 'reply-0', question: '' });
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set());
  const session = useRef<string | null>(null);
  const handle = useRef<TurnHandle | null>(null);
  /** Bumped per turn, on package change and on unmount; an item for an older turn is dropped. */
  const seq = useRef(0);
  const nextKey = useRef(0);

  useEffect(
    () => () => {
      seq.current += 1;
      handle.current?.abort();
    },
    [],
  );

  const streaming = active && turn.status === 'streaming';

  async function run(request: TurnRequest) {
    handle.current?.abort();
    handle.current = null;
    const mine = ++seq.current;
    const onItem = (item: StreamItem) => {
      if (seq.current === mine) dispatch(item);
    };
    dispatch({ kind: 'reset' });
    setActive(true);
    let sid = session.current;
    if (sid === null) {
      let started;
      try {
        started = await start(agentId, packageId);
      } catch {
        started = { ok: false as const, code: 'provider_error' as const, retryable: true };
      }
      if (!started.ok) {
        onItem({ kind: 'event', event: { type: 'error', code: started.code, retryable: started.retryable } });
        return;
      }
      if (seq.current !== mine) return;
      sid = started.sessionId;
      session.current = sid;
    }
    handle.current = send({
      sessionId: sid,
      body: { agentId, ...request, lang: 'en', clientTs: now().toISOString() },
      onItem,
    });
  }

  function submit(request: TurnRequest, shown: string) {
    const key = `local-${nextKey.current++}`;
    setThread((items) => {
      const out = [...items];
      // The previous turn, if it finished, now becomes an ordinary thread entry.
      // It keeps its key, so an open correction form or a confirmation stays with it.
      if (active && turn.status === 'final') {
        out.push({ key: reply.key, role: 'agent', text: turn.text, turn, question: reply.question });
      }
      out.push({ key, role: 'student', text: shown });
      return out;
    });
    setReply({ key: `${key}-reply`, question: shown });
    setLastRequest(request);
    void run(request);
  }

  function changePackage(next: string) {
    seq.current += 1;
    handle.current?.abort();
    handle.current = null;
    session.current = null;
    dispatch({ kind: 'reset' });
    setActive(false);
    setThread([]);
    setLastRequest(null);
    setOpenForm(null);
    setSaved(new Set());
    setPackageId(next);
  }

  const markSaved = (key: string) => setSaved((s) => new Set(s).add(key));
  const actions = { open: openForm, saved, modules, correct, setOpen: setOpenForm, markSaved };
  const finalTurn = active && turn.status === 'final' ? turn : null;
  const failed = active && turn.status === 'failed' ? turn.error : null;

  return (
    <div className="chat test-chat">
      <div className="test-chat-picker">
        <label htmlFor={pickerId}>{t('packageLabel')}</label>
        <select id={pickerId} value={packageId} onChange={(e) => changePackage(e.target.value)}>
          {packages.map((p) => (
            <option key={p.packageId} value={p.packageId}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="test-chat-hint">{t('packageHint')}</p>
      </div>
      <section className="chat-thread-wrap" aria-label={chat('threadLabel')}>
        {thread.length === 0 && !active ? <p className="chat-empty">{chat('empty')}</p> : null}
        <ol className="chat-thread" aria-live="polite">
          {thread.map((item) => (
            <li key={item.key}>
              {item.role === 'student' ? (
                <MessageBubble role="student" text={item.text} />
              ) : (
                <MessageBubble role="agent" text={item.text} replaced={item.turn.replaced}>
                  <TurnExtras turn={item.turn} />
                  <ReplyActions replyKey={item.key} question={item.question} answer={item.text} {...actions} />
                </MessageBubble>
              )}
            </li>
          ))}
          {finalTurn === null ? null : (
            <li key={reply.key}>
              <MessageBubble role="agent" text={finalTurn.text} replaced={finalTurn.replaced}>
                <TurnExtras turn={finalTurn} />
                <ReplyActions replyKey={reply.key} question={reply.question} answer={finalTurn.text} {...actions} />
              </MessageBubble>
            </li>
          )}
        </ol>
        {streaming ? (
          <div className="chat-provisional">
            <MessageBubble role="agent" text={turn.text} provisional replaced={turn.replaced}>
              <TurnExtras turn={turn} />
            </MessageBubble>
          </div>
        ) : null}
        {failed === null ? null : (
          <div className="chat-error" role="alert">
            <p>{failed.text}</p>
            {failed.retryable && lastRequest !== null ? (
              <button type="button" onClick={() => void run(lastRequest)}>
                {chat('retry')}
              </button>
            ) : null}
          </div>
        )}
      </section>
      <HintButton
        rung={active ? turn.hintRung : null}
        disabled={streaming}
        onHint={() => submit({ kind: 'hint_request' }, chat('hintAsked'))}
      />
      <Composer disabled={streaming} onSend={(text) => submit({ kind: 'message', text }, text)} />
    </div>
  );
}
