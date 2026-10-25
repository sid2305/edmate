// Task 9.5b, extended by 13.skillpresent Phase B: shown only while the mock interview is the
// active skill. Pause and Stop send ordinary `message` turns with the literal text `/pause` and
// `stop` (`rolePlayControl`'s own parsing, unchanged -- these are chat text, not a new turn kind).
// `ChatView` wires the actual text and `skill: 'mock_interview'` tag onto the request; this
// component only raises the intent.
//
// 13.skillpresent: the harness now also emits a harness-computed `type: 'skill', skill:
// 'mock_interview'` progress event every role-play turn (Phase A), carrying the clamped
// `RolePlay` the pedagogy layer derived (never the model's own count). `ChatView` passes that
// event's payload here, already `safeParse`'d by `parseRolePlayProgress` (the UI-state lesson:
// trust neither the server payload's shape); an unparseable or missing payload renders no
// progress line at all rather than guessing, the same fallback this component already had before
// this event existed.
import { useTranslations } from 'next-intl';
import { z } from 'zod';

const rolePlayProgressSchema = z.union([
  z.strictObject({ phase: z.enum(['question', 'pause', 'resume']), question: z.number(), total: z.number() }),
  z.strictObject({ phase: z.literal('debrief'), total: z.number() }),
  z.strictObject({ phase: z.literal('stopped'), answered: z.number() }),
  z.strictObject({ phase: z.literal('ended') }),
]);

/** The harness-computed role-play payload, once validated. Mirrors `RolePlay` in
 * `packages/harness/src/pedagogy/roleplay.ts`; duplicated here (not imported) because this is a
 * client component and the harness is a server-only package. */
export type RolePlayProgress = z.infer<typeof rolePlayProgressSchema>;

/** `payload` straight off a `skill: 'mock_interview'` `TurnEvent`, or `null` when it does not
 * parse (an older/un-upgraded harness, or any other shape) -- never throws. */
export function parseRolePlayProgress(payload: unknown): RolePlayProgress | null {
  const parsed = rolePlayProgressSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export interface MockInterviewControlsProps {
  disabled: boolean;
  onPause: () => void;
  onStop: () => void;
  /** The latest validated progress for this interview, or `null` to show no progress line (an
   * older reply, or one whose payload did not parse). */
  progress: RolePlayProgress | null;
}

export function MockInterviewControls({ disabled, onPause, onStop, progress }: MockInterviewControlsProps) {
  const t = useTranslations('chat');
  const progressText = ((): string | null => {
    if (progress === null) return null;
    switch (progress.phase) {
      case 'question':
      case 'resume':
        return t('mockInterview.progress.question', { question: progress.question, total: progress.total });
      case 'pause':
        return t('mockInterview.progress.paused', { question: progress.question, total: progress.total });
      case 'debrief':
        return t('mockInterview.progress.debrief', { total: progress.total });
      case 'stopped':
        return t('mockInterview.progress.stopped', { answered: progress.answered });
      case 'ended':
        return t('mockInterview.progress.ended');
    }
  })();
  return (
    <div className="chat-mock-interview-controls">
      {progressText === null ? null : (
        <p className="chat-mock-interview-progress" role="status">
          {progressText}
        </p>
      )}
      <button type="button" disabled={disabled} onClick={onPause}>
        {t('mockInterview.pause')}
      </button>
      <button type="button" disabled={disabled} onClick={onStop}>
        {t('mockInterview.stop')}
      </button>
    </div>
  );
}
