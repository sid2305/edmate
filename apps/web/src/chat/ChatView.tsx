'use client';
// Task 9.4 Phase C: the student chat. One turn at a time runs through `useReducer(reduceTurn)`
// fed by `sendTurn`'s stream items (the Phase B safety core):
// - While the reply streams it is provisional: shown outside the `aria-live` thread, muted and
//   labelled "Still checking". Only on `done` does it join the live thread.
// - `replace ''` clears what was shown; a corrected reply is marked "Updated".
// - An error, or a stream that ends without `done`, drops the reply and shows fixed text (never
//   the server's), with a retry when the error is retryable.
// - Leaving the page aborts the turn; items that arrive late for an older turn are ignored.
import type { Skill, SourceRef } from '@edmate/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ClientTurn } from '../turn/clientInput';
import { Composer } from './Composer';
import { HintButton } from './HintButton';
import { LockedNotice } from './LockedNotice';
import { MessageBubble, type MessageRole } from './MessageBubble';
import { PracticeCard, type PracticeCardData } from './PracticeCard';
import { sendTurn as realSendTurn, startSession as realStartSession, type TurnHandle } from './sendTurn';
import { SkillCard } from './SkillCard';
import { SkillLauncher } from './SkillLauncher';
import { SourcesList } from './SourcesList';
import { TeacherQuestionNotice } from './TeacherQuestionNotice';
import { initialTurn, reduceTurn, type SkillCardData, type StreamItem, type TurnView } from './turnState';

/** Is `payload` a well-shaped practice item (the one skill with a dedicated card)? */
function asPracticeCard(card: SkillCardData): PracticeCardData | null {
  if (card.skill !== 'practice') return null;
  const p = card.payload;
  if (typeof p !== 'object' || p === null) return null;
  const { id, kind, level, prompt, options } = p as Record<string, unknown>;
  if (typeof id !== 'string' || typeof prompt !== 'string') return null;
  if (kind !== 'numeric' && kind !== 'mcq' && kind !== 'short' && kind !== 'code_output') return null;
  if (level !== 1 && level !== 2 && level !== 3) return null;
  if (options !== undefined && !Array.isArray(options)) return null;
  return { id, kind, level, prompt, ...(options === undefined ? {} : { options }) };
}

/** A finalised message: from history, or a turn that reached `done`. */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  sources?: readonly SourceRef[];
}

export interface ChatViewProps {
  agentId: string;
  /** The session from `?s=`, when it is the student's own open session with this agent. */
  sessionId: string | null;
  history: readonly ChatMessage[];
  /** Injected in tests; the real fetch-based client otherwise. */
  send?: typeof realSendTurn;
  start?: typeof realStartSession;
  now?: () => Date;
}

type TurnRequest = Pick<ClientTurn, 'kind' | 'text' | 'skill' | 'skillPayload'>;
type ChatAction = StreamItem | { kind: 'reset' };

function chatTurn(state: TurnView, action: ChatAction): TurnView {
  return action.kind === 'reset' ? initialTurn() : reduceTurn(state, action);
}

/** A thread entry: a plain message, or a finished turn with its cards and notices. */
type ThreadItem = { key: string; message: ChatMessage; turn?: TurnView };

function TurnExtras({
  turn,
  disabled,
  onPracticeAnswer,
}: {
  turn: TurnView;
  disabled: boolean;
  onPracticeAnswer: (text: string) => void;
}) {
  return (
    <>
      {turn.skills.map((s, i) => {
        const practice = asPracticeCard(s);
        return practice === null ? (
          <SkillCard key={i} skill={s.skill} />
        ) : (
          <PracticeCard key={i} item={practice} onAnswer={onPracticeAnswer} disabled={disabled} />
        );
      })}
      {turn.locked === null ? null : <LockedNotice {...turn.locked} />}
      {turn.teacherQuestionId === null ? null : <TeacherQuestionNotice />}
      <SourcesList items={turn.sources} />
    </>
  );
}

export function ChatView({
  agentId,
  sessionId,
  history,
  send = realSendTurn,
  start = realStartSession,
  now = () => new Date(),
}: ChatViewProps) {
  const t = useTranslations('chat');
  const [thread, setThread] = useState<ThreadItem[]>(() =>
    history.map((m) => ({ key: m.id, message: m })),
  );
  const [turn, dispatch] = useReducer(chatTurn, undefined, initialTurn);
  /** True once a turn has been started; `turn` is meaningless before. */
  const [active, setActive] = useState(false);
  const [lastRequest, setLastRequest] = useState<TurnRequest | null>(null);
  /** The skill named by the last final turn's own `skill` event (last one wins); attached to the
   * next submit/hint unless that call names its own `skill` (9.5a: so a practice `check_answer`
   * and a hint asked mid-practice both stay on the practice ladder). */
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
  const session = useRef<string | null>(sessionId);
  const handle = useRef<TurnHandle | null>(null);
  /** Bumped per turn and on unmount; an item for an older turn is dropped. */
  const seq = useRef(0);
  const nextKey = useRef(0);

  useEffect(
    () => () => {
      seq.current += 1;
      handle.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!active || turn.status !== 'final') return;
    const last = turn.skills.at(-1);
    if (last !== undefined) setActiveSkill(last.skill);
  }, [active, turn]);

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
      const started = await start(agentId);
      if (!started.ok) {
        onItem({ kind: 'event', event: { type: 'error', code: started.code, retryable: started.retryable } });
        return;
      }
      if (seq.current !== mine) return;
      sid = started.sessionId;
      session.current = sid;
      window.history.replaceState(window.history.state, '', `?s=${encodeURIComponent(sid)}`);
    }
    handle.current = send({
      sessionId: sid,
      body: { agentId, ...request, lang: 'en', clientTs: now().toISOString() },
      onItem,
    });
  }

  function submit(request: TurnRequest, shown: string) {
    const effective: TurnRequest =
      request.skill !== undefined || activeSkill === null
        ? request
        : { ...request, skill: activeSkill };
    const key = `local-${nextKey.current++}`;
    setThread((items) => {
      const out = [...items];
      // The previous turn, if it finished, now becomes an ordinary thread entry.
      if (active && turn.status === 'final') {
        out.push({
          key: `${key}-reply`,
          message: { id: turn.messageId ?? key, role: 'agent', text: turn.text },
          turn,
        });
      }
      out.push({ key, message: { id: key, role: 'student', text: shown } });
      return out;
    });
    setLastRequest(effective);
    void run(effective);
  }

  function answerPractice(text: string) {
    submit({ kind: 'check_answer', text, skill: 'practice' }, text);
  }

  const finalTurn = active && turn.status === 'final' ? turn : null;
  const failed = active && turn.status === 'failed' ? turn.error : null;

  return (
    <div className="chat">
      <section className="chat-thread-wrap" aria-label={t('threadLabel')}>
        {thread.length === 0 && !active ? <p className="chat-empty">{t('empty')}</p> : null}
        <ol className="chat-thread" aria-live="polite">
          {thread.map((item) => (
            <li key={item.key}>
              <MessageBubble role={item.message.role} text={item.message.text} replaced={item.turn?.replaced ?? false}>
                {item.turn === undefined ? (
                  <SourcesList items={item.message.sources ?? []} />
                ) : (
                  <TurnExtras turn={item.turn} disabled={streaming} onPracticeAnswer={answerPractice} />
                )}
              </MessageBubble>
            </li>
          ))}
          {finalTurn === null ? null : (
            <li key="current">
              <MessageBubble role="agent" text={finalTurn.text} replaced={finalTurn.replaced}>
                <TurnExtras turn={finalTurn} disabled={streaming} onPracticeAnswer={answerPractice} />
              </MessageBubble>
            </li>
          )}
        </ol>
        {streaming ? (
          <div className="chat-provisional">
            <MessageBubble role="agent" text={turn.text} provisional replaced={turn.replaced}>
              <TurnExtras turn={turn} disabled={streaming} onPracticeAnswer={answerPractice} />
            </MessageBubble>
          </div>
        ) : null}
        {failed === null ? null : (
          <div className="chat-error" role="alert">
            <p>{failed.text}</p>
            {failed.retryable && lastRequest !== null ? (
              <button type="button" onClick={() => void run(lastRequest)}>
                {t('retry')}
              </button>
            ) : null}
          </div>
        )}
      </section>
      <HintButton
        rung={active ? turn.hintRung : null}
        disabled={streaming}
        onHint={() => submit({ kind: 'hint_request' }, t('hintAsked'))}
      />
      <SkillLauncher
        disabled={streaming}
        onStartPractice={() => submit({ kind: 'message', text: t('practice.start'), skill: 'practice' }, t('practice.start'))}
      />
      <Composer disabled={streaming} onSend={(text) => submit({ kind: 'message', text }, text)} />
    </div>
  );
}
