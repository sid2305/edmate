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
import { z } from 'zod';
import type { ClientTurn } from '../turn/clientInput';
import { Composer } from './Composer';
import { HintButton } from './HintButton';
import { LockedNotice } from './LockedNotice';
import { MessageBubble, type MessageRole } from './MessageBubble';
import { MockInterviewControls } from './MockInterviewControls';
import { PracticeCard, type PracticeCardData } from './PracticeCard';
import { sendTurn as realSendTurn, startSession as realStartSession, type TurnHandle } from './sendTurn';
import { SkillCard } from './SkillCard';
import { SkillLauncher, type MockInterviewPersona } from './SkillLauncher';
import { SourcesList } from './SourcesList';
import { TeacherQuestionNotice } from './TeacherQuestionNotice';
import { initialTurn, reduceTurn, type SkillCardData, type StreamItem, type TurnView } from './turnState';

/** The practice item payload (the one skill with a dedicated card). */
const practicePayload = z.object({
  id: z.string(),
  kind: z.enum(['numeric', 'mcq', 'short', 'code_output']),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
});

/** Is `payload` a well-shaped practice item? A failed parse falls back to the generic SkillCard. */
function asPracticeCard(card: SkillCardData): PracticeCardData | null {
  if (card.skill !== 'practice') return null;
  const parsed = practicePayload.safeParse(card.payload);
  if (!parsed.success) return null;
  const { id, kind, level, prompt, options } = parsed.data;
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
  /** The skill named by the last final turn's own `skill` event (last one wins), or null when that
   * turn had no skill cards. Carried onto the next `hint_request` or `check_answer` that names no
   * `skill` of its own (9.5a: a hint asked mid-practice stays on the practice ladder); never onto a
   * plain `message`, so leaving practice by typing is not silently tagged. */
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
  /** One-shot: set by the "Get feedback" toggle, consumed (and cleared) by the next Composer
   * send. Unlike `activeSkill`, feedback never persists across turns (5.7 is a single verdict,
   * not a ladder). */
  const [feedbackPending, setFeedbackPending] = useState(false);
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
    // Practice (and any future skill with a dedicated `skill` event) is derived from the turn's
    // own skill cards, last one wins, and clears when a turn has none. Mock interview never
    // tool-wires a `present()` hook (Q2, 9.5 plan) so no turn ever carries a `skill:
    // 'mock_interview'` event; it is set directly by the start/pause action below and only
    // cleared by Stop, so a reply with no skill cards never silently drops the student out of it.
    // A locked reply (student without the package) also has no skill cards, but it is never an
    // in-progress interview turn -- it always clears, so a locked start never gets stuck tagged
    // `mock_interview` with Pause/Stop left showing.
    const named = turn.skills.at(-1)?.skill;
    setActiveSkill((prev) =>
      named !== undefined ? named : turn.locked !== null ? null : prev === 'mock_interview' ? prev : null,
    );
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
    // A plain Composer message never carries the active skill along -- except mock interview,
    // whose answers *are* ordinary typed messages (there is no dedicated answer form, unlike
    // practice's PracticeCard), so leaving it is Stop's job, not a side effect of typing.
    const carries =
      request.skill === undefined &&
      activeSkill !== null &&
      (request.kind !== 'message' || activeSkill === 'mock_interview');
    const effective: TurnRequest = carries ? { ...request, skill: activeSkill } : request;
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

  function startMockInterview(persona: MockInterviewPersona) {
    submit({ kind: 'skill_action', skill: 'mock_interview', skillPayload: { persona } }, t('mockInterview.start'));
    setActiveSkill('mock_interview');
  }

  function pauseMockInterview() {
    submit({ kind: 'message', text: '/pause', skill: 'mock_interview' }, '/pause');
  }

  function stopMockInterview() {
    submit({ kind: 'message', text: 'stop', skill: 'mock_interview' }, 'stop');
    setActiveSkill(null);
  }

  function sendMessage(text: string) {
    const tagged = feedbackPending ? ({ kind: 'message', text, skill: 'feedback' } as const) : ({ kind: 'message', text } as const);
    submit(tagged, text);
    if (feedbackPending) setFeedbackPending(false);
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
      {activeSkill === 'mock_interview' ? (
        <MockInterviewControls disabled={streaming} onPause={pauseMockInterview} onStop={stopMockInterview} />
      ) : null}
      <SkillLauncher
        disabled={streaming}
        onStartPractice={() => submit({ kind: 'message', text: t('practice.start'), skill: 'practice' }, t('practice.start'))}
        feedbackActive={feedbackPending}
        onToggleFeedback={() => setFeedbackPending((v) => !v)}
        onStartMockInterview={startMockInterview}
      />
      <Composer disabled={streaming} onSend={sendMessage} />
    </div>
  );
}
