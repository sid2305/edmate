// Task 9.4 Phase C: the tutor passed the question to the teacher.
import { useTranslations } from 'next-intl';

export function TeacherQuestionNotice() {
  const t = useTranslations('chat');
  return <p className="chat-notice">{t('teacherQuestion')}</p>;
}
