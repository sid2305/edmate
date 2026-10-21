// Task 9.4: the client turn state, a pure reducer over the validated stream items (the safety core
// of the chat; plan rules 1-8).
// - Text and skill cards are provisional (`streaming`) until `done`; only then is the turn final.
// - `replace` sets the text; if anything was shown before, the turn is marked `replaced` (shown as
//   "Updated"). `replace ''` also clears skill cards and sources, so a retry streams into a clean
//   turn.
// - `error`, or the stream ending with no `done`, drops text, skills and sources and shows fixed
//   English text for the code (never server text).
// - Nothing changes the turn after `done` or `error`.
import type { ErrorCode, Skill, SourceRef, TurnEvent } from '@edmate/contracts';
import { errorText } from './errorText';

/** One item from the SSE reader: a validated event, or the end of the stream. */
export type StreamItem = { kind: 'event'; event: TurnEvent } | { kind: 'ended' };

export type TurnStatus = 'streaming' | 'final' | 'failed';

export interface SkillCardData {
  skill: Skill;
  payload: unknown;
}

export interface TurnError {
  code: ErrorCode;
  retryable: boolean;
  /** Fixed English text for `code` (errorText). */
  text: string;
}

export interface TurnView {
  status: TurnStatus;
  text: string;
  skills: readonly SkillCardData[];
  sources: readonly SourceRef[];
  hintRung: number | null;
  locked: { packageName?: string } | null;
  teacherQuestionId: string | null;
  safety: 'info' | 'alert' | null;
  /** True once a `replace` changed text or cards the student had already seen. */
  replaced: boolean;
  messageId: string | null;
  error: TurnError | null;
}

export function initialTurn(): TurnView {
  return {
    status: 'streaming',
    text: '',
    skills: [],
    sources: [],
    hintRung: null,
    locked: null,
    teacherQuestionId: null,
    safety: null,
    replaced: false,
    messageId: null,
    error: null,
  };
}

function fail(state: TurnView, code: ErrorCode, retryable: boolean): TurnView {
  return {
    ...state,
    status: 'failed',
    text: '',
    skills: [],
    sources: [],
    replaced: false,
    error: { code, retryable, text: errorText(code) },
  };
}

function applyEvent(state: TurnView, e: TurnEvent): TurnView {
  switch (e.type) {
    case 'token':
      return { ...state, text: state.text + e.text };
    case 'skill':
      return { ...state, skills: [...state.skills, { skill: e.skill, payload: e.payload }] };
    case 'sources':
      return { ...state, sources: e.items };
    case 'hint_rung':
      return { ...state, hintRung: e.rung };
    case 'locked':
      return { ...state, locked: e.packageName === undefined ? {} : { packageName: e.packageName } };
    case 'teacher_question':
      return { ...state, teacherQuestionId: e.questionId };
    case 'safety':
      return { ...state, safety: e.level };
    case 'replace': {
      const shown = state.text !== '' || state.skills.length > 0;
      const replaced = state.replaced || shown;
      if (e.text === '') return { ...state, text: '', skills: [], sources: [], replaced };
      return { ...state, text: e.text, replaced };
    }
    case 'done':
      return { ...state, status: 'final', messageId: e.messageId };
    case 'error':
      return fail(state, e.code, e.retryable);
  }
}

/** The next turn state. Returns `state` itself when the item is ignored (after done or error). */
export function reduceTurn(state: TurnView, item: StreamItem): TurnView {
  if (state.status !== 'streaming') return state;
  if (item.kind === 'ended') return fail(state, 'provider_error', true);
  return applyEvent(state, item.event);
}
