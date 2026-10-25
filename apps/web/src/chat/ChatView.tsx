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
import { MockInterviewControls, parseRolePlayProgress, type RolePlayProgress } from './MockInterviewControls';
import { PracticeCard, type PracticeCardData } from './PracticeCard';
import { ReportButton } from './ReportButton';
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

/** 12.2c: the server message id a reply can be reported under, or null when it has none yet.
 * A history item's own id is already a server id; a turn pushed into the thread (or shown as the
 * latest final reply) can only be reported once it carries `messageId` from the `done` event. */
function reportableId(message: ChatMessage, turn?: TurnView): string | null {
  if (message.role !== 'agent' && message.role !== 'teacher') return null;
  return turn === undefined ? message.id : turn.messageId;
}

function TurnExtras({
  turn,
  disabled,
  onPracticeAnswer,
}: {
  turn: TurnView;
  disabled: boolean;
  onPracticeAnswer: (text: string) => void;
}) {
  const t = useTranslations('chat');
  return (
    <>
      {turn.skills.map((s, i) => {
        // 13.skillpresent: mock-interview's progress is shown next to the Pause/Stop controls
        // (`MockInterviewControls`), not as a thread card -- a "Mock interview - Coming soon" card
        // every turn would be noise once the harness carries real progress. Feedback has no
        // computed verdict to show (ADR-0012 bans a score); the event is only a confirmation that
        // this reply is the verdict, so it renders a short marker line instead of the generic
        // "Coming soon" card.
        if (s.skill === 'mock_interview') {
          const progress = parseRolePlayProgress(s.payload);
          // While the interview is still live (question/pause/resume/debrief), progress shows
          // next to the Pause/Stop controls instead (so it stays visible as a non-live region
          // update too). Once the harness decides the turn is terminal (`stopped`/`ended`),
          // Pause/Stop disappear (see the activeSkill effect below), so the terminal line is the
          // only trace of this turn's progress left -- rendered here, in the thread, instead.
          if (progress?.phase === 'stopped') {
            return (
              <p key={i} className="chat-mock-interview-progress">
                {t('mockInterview.progress.stopped', { answered: progress.answered })}
              </p>
            );
          }
          if (progress?.phase === 'ended') {
            return (
              <p key={i} className="chat-mock-interview-progress">
                {t('mockInterview.progress.ended')}
              </p>
            );
          }
          return null;
        }
        if (s.skill === 'feedback') return <p key={i} className="chat-feedback-given">{t('feedback.given')}</p>;
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
  /** 12.2c fix round: a report's busy/done half, keyed by `messageId` (not the component instance
   * -- a final turn is first shown as the current turn, then re-rendered under a new thread key
   * once the student sends another message; without this a report in flight, or its "Thanks"
   * result, was lost on that remount). `'idle'` clears the entry rather than storing it. */
  const [reportState, setReportState] = useState<Record<string, 'busy' | 'done'>>({});
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
    // own skill cards, last one wins, and clears when a turn has none. 13.skillpresent Phase B
    // (plan Q3): a mock-interview turn now always carries a harness-computed `skill:
    // 'mock_interview'` progress event (Phase A), so `named` is 'mock_interview' for every turn in
    // the interview including the stop/debrief turn itself -- `named` alone can no longer tell a
    // live turn from a terminal one. The Stop button (below) stays one explicit reset point
    // (students must always be able to leave), and this effect *also* clears `activeSkill` once
    // the latest skill card's own `phase` is `'stopped'` or `'ended'` -- both harness-decided
    // terminal states -- so typing a bare "stop" (not clicking the button) still leaves the
    // interview. A locked reply (student without the package) also has no skill cards, but it is
    // never an in-progress interview turn -- it always clears, so a locked start never gets stuck
    // tagged `mock_interview` with Pause/Stop left showing.
    const lastCard = turn.skills.at(-1);
    const named = lastCard?.skill;
    const progress = named === 'mock_interview' ? parseRolePlayProgress(lastCard?.payload) : null;
    const terminal = progress !== null && (progress.phase === 'stopped' || progress.phase === 'ended');
    setActiveSkill((prev) => {
      if (terminal) return null;
      if (named !== undefined) return named;
      if (turn.locked !== null) return null;
      return prev === 'mock_interview' ? prev : null;
    });
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

  function setReportStatus(messageId: string, status: 'idle' | 'busy' | 'done') {
    setReportState((prev) => {
      if (status === 'idle') {
        if (!(messageId in prev)) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      }
      return { ...prev, [messageId]: status };
    });
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

  // The latest validated mock-interview progress for the turn on screen (current or final), for
  // `MockInterviewControls`; `null` while streaming before any skill card has arrived, or if the
  // payload did not parse (the UI-state lesson: render a fallback, never guess).
  const rolePlayProgress: RolePlayProgress | null = (() => {
    if (!active) return null;
    const card = [...turn.skills].reverse().find((s) => s.skill === 'mock_interview');
    return card === undefined ? null : parseRolePlayProgress(card.payload);
  })();
  const finalTurn = active && turn.status === 'final' ? turn : null;
  const failed = active && turn.status === 'failed' ? turn.error : null;
  // The session a reported message belongs to: the ref once a turn has started, else the page's
  // own `?s=` session (history was loaded from it). Never the request body (12.2c design).
  const reportSessionId = session.current ?? sessionId;

  return (
    <div className="chat">
      <section className="chat-thread-wrap" aria-label={t('threadLabel')}>
        {thread.length === 0 && !active ? <p className="chat-empty">{t('empty')}</p> : null}
        <ol className="chat-thread" aria-live="polite">
          {thread.map((item) => {
            const reportId = reportableId(item.message, item.turn);
            return (
              <li key={item.key}>
                <MessageBubble role={item.message.role} text={item.message.text} replaced={item.turn?.replaced ?? false}>
                  {item.turn === undefined ? (
                    <SourcesList items={item.message.sources ?? []} />
                  ) : (
                    <TurnExtras turn={item.turn} disabled={streaming} onPracticeAnswer={answerPractice} />
                  )}
                  {reportId === null ? null : (
                    <ReportButton
                      agentId={agentId}
                      sessionId={reportSessionId}
                      messageId={reportId}
                      status={reportState[reportId]}
                      onStatusChange={(s) => setReportStatus(reportId, s)}
                    />
                  )}
                </MessageBubble>
              </li>
            );
          })}
          {finalTurn === null ? null : (
            <li key="current">
              <MessageBubble role="agent" text={finalTurn.text} replaced={finalTurn.replaced}>
                <TurnExtras turn={finalTurn} disabled={streaming} onPracticeAnswer={answerPractice} />
                {(() => {
                  const finalMessageId = finalTurn.messageId;
                  return finalMessageId === null ? null : (
                    <ReportButton
                      agentId={agentId}
                      sessionId={reportSessionId}
                      messageId={finalMessageId}
                      status={reportState[finalMessageId]}
                      onStatusChange={(s) => setReportStatus(finalMessageId, s)}
                    />
                  );
                })()}
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
        <MockInterviewControls
          disabled={streaming}
          onPause={pauseMockInterview}
          onStop={stopMockInterview}
          progress={rolePlayProgress}
        />
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
