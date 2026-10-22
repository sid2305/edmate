// Task 9.2 Phase B: one search-result card. Teacher-written text (subject, bio) renders as plain
// text only -- no markdown, no `dangerouslySetInnerHTML` (scope decision 5: a failure is visible,
// not papered over by rendering unsafe markup).
import type { PublicTeacherCard } from '@edmate/db';

export interface TeacherCardProps {
  teacher: PublicTeacherCard;
  /** "Free package" (en.json's discovery.freeBadge), shown only when the teacher has one. */
  freeLabel: string;
}

export function TeacherCard({ teacher, freeLabel }: TeacherCardProps) {
  return (
    <article className="teacher-card">
      <h2>
        <a href={`/teachers/${encodeURIComponent(teacher.slug)}`}>{teacher.displayName}</a>
      </h2>
      <p className="teacher-card-subject">{teacher.subject}</p>
      <p className="teacher-card-bio">{teacher.bio}</p>
      {teacher.languages.length > 0 ? (
        <p className="teacher-card-languages">{teacher.languages.join(', ')}</p>
      ) : null}
      {teacher.hasFree ? <span className="badge">{freeLabel}</span> : null}
    </article>
  );
}
