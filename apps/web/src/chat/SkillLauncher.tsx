// Task 9.5a/9.5b: launches a skill from the chat. "Practice" (9.5a) starts the practice ladder.
// "Get feedback" (9.5b) is a one-shot toggle: it tags only the next Composer send with
// `skill: 'feedback'` -- 5.7's feedback pack is a single verdict, not a ladder, so it never
// becomes `activeSkill` the way practice/mock-interview do (`ChatView` owns that distinction).
// The two mock-interview persona buttons send `skill_action` + `skillPayload: {persona}` (Q1:
// both signed personas, job-interview and viva, hardcoded for the pilot).
import { useTranslations } from 'next-intl';

export type MockInterviewPersona = 'job-interview' | 'viva';

export interface SkillLauncherProps {
  disabled: boolean;
  onStartPractice: () => void;
  /** Whether the next Composer send will be tagged `skill: 'feedback'`. */
  feedbackActive: boolean;
  onToggleFeedback: () => void;
  onStartMockInterview: (persona: MockInterviewPersona) => void;
}

export function SkillLauncher({
  disabled,
  onStartPractice,
  feedbackActive,
  onToggleFeedback,
  onStartMockInterview,
}: SkillLauncherProps) {
  const t = useTranslations('chat');
  return (
    <div className="chat-skill-launcher">
      <button type="button" disabled={disabled} onClick={onStartPractice}>
        {t('skills.launcher.practice')}
      </button>
      <button type="button" disabled={disabled} aria-pressed={feedbackActive} onClick={onToggleFeedback}>
        {t('feedback.toggle')}
      </button>
      <div className="chat-mock-interview-launcher">
        <span>{t('mockInterview.launcher')}</span>
        <button type="button" disabled={disabled} onClick={() => onStartMockInterview('job-interview')}>
          {t('mockInterview.personas.job-interview')}
        </button>
        <button type="button" disabled={disabled} onClick={() => onStartMockInterview('viva')}>
          {t('mockInterview.personas.viva')}
        </button>
      </div>
    </div>
  );
}
