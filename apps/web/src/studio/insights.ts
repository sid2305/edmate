// Task 8.8 Phase A: the insights aggregation, pure (no React, no db, no model calls). Feeds the
// `/teacher/insights` page (Phase B) two teacher-wide, student-blind reads: turn health (7.7's
// `computeHealthMetrics` over 7.7's own `turnTraces.listForTeacherSince`) and the top open
// question groups (5.10's `teacherQuestions.listGroupsForTeacher`). Neither read selects a
// student id (see each repo's own comment), and this module adds none of its own: `sample` is
// just the group's own oldest-first first question text, already scrubbed the same way 8.9's
// inbox shows it.
import type { Repositories, TeacherQuestionGroup, TeacherScope } from '@edmate/db';
import { TEACHER_TRACES_MAX_LIMIT } from '@edmate/db';
import { computeHealthMetrics, type HealthMetrics } from '@edmate/harness';

/** The last 7 days (lead answer, 22 Oct 2026, Q1): no config knob in this MVP slice. */
export const INSIGHTS_WINDOW_DAYS = 7;
/** Top 5 open question groups by count (lead answer, Q2); no minimum group size (Q3). */
export const INSIGHTS_TOP_GROUPS = 5;

/** Everything `loadInsights` needs: the two repo methods it calls, narrowed like
 * `OutlineBackend`/`ProfileBackend`, so the test below needs no real db (rule 4). */
export interface InsightsBackend {
  turnTraces: Pick<Repositories['turnTraces'], 'listForTeacherSince'>;
  teacherQuestions: Pick<Repositories['teacherQuestions'], 'listGroupsForTeacher'>;
}

/** One open question group, as shown to the teacher: no student id anywhere (the accept line). */
export interface InsightsQuestionGroup {
  groupId: string;
  count: number;
  oldestAt: string;
  /** The group's oldest question's text, already scrubbed; '' if the group is somehow empty. */
  sample: string;
}

export interface Insights {
  windowDays: number;
  health: HealthMetrics;
  /** True when the 7-day window held >= `TEACHER_TRACES_MAX_LIMIT` turns: `health` is then the
   * most recent `TEACHER_TRACES_MAX_LIMIT`, not the full week -- the page must say so, never
   * present a capped read as the whole window. */
  capped: boolean;
  topQuestionGroups: InsightsQuestionGroup[];
}

function toQuestionGroup(g: TeacherQuestionGroup): InsightsQuestionGroup {
  return { groupId: g.groupId, count: g.count, oldestAt: g.oldestAt, sample: g.questions[0]?.text ?? '' };
}

/**
 * The teacher-wide insights page's data: turn health over the last `INSIGHTS_WINDOW_DAYS` days,
 * plus the top `INSIGHTS_TOP_GROUPS` open question groups. `now` is injectable for deterministic
 * tests; defaults to the server's own clock (no locale-pack timezone lookup -- that's 11.3's).
 */
export async function loadInsights(
  backend: InsightsBackend,
  scope: TeacherScope,
  now: Date = new Date(),
): Promise<Insights> {
  const since = new Date(now.getTime() - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [traces, groups] = await Promise.all([
    backend.turnTraces.listForTeacherSince(scope, since),
    backend.teacherQuestions.listGroupsForTeacher(scope, { limit: INSIGHTS_TOP_GROUPS }),
  ]);
  return {
    windowDays: INSIGHTS_WINDOW_DAYS,
    health: computeHealthMetrics(traces),
    capped: traces.length >= TEACHER_TRACES_MAX_LIMIT,
    topQuestionGroups: groups.map(toQuestionGroup),
  };
}
