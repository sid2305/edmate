// Task 9.4 Phase C: a minimal skill card -- the skill's name and "Coming soon". The skill's
// payload is never rendered (skill screens are 9.5).
import type { Skill } from '@edmate/contracts';
import { useTranslations } from 'next-intl';

export function SkillCard({ skill }: { skill: Skill }) {
  const t = useTranslations('chat');
  return (
    <div className="skill-card">
      <strong>{t(`skills.${skill}`)}</strong> <span>{t('skillComingSoon')}</span>
    </div>
  );
}
