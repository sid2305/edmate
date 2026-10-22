// Task 9.5a: launches a skill from the chat. Phase A ships one button, "Practice" (feedback and
// mock-interview launchers are 9.5b, same file).
import { useTranslations } from 'next-intl';

export interface SkillLauncherProps {
  disabled: boolean;
  onStartPractice: () => void;
}

export function SkillLauncher({ disabled, onStartPractice }: SkillLauncherProps) {
  const t = useTranslations('chat');
  return (
    <div className="chat-skill-launcher">
      <button type="button" disabled={disabled} onClick={onStartPractice}>
        {t('skills.launcher.practice')}
      </button>
    </div>
  );
}
