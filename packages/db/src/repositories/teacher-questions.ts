import { randomUUID } from 'node:crypto';
import { LIMITS, TeacherQuestionSchema, type TeacherQuestion } from '@edmate/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { agents, messages, notifications, sessions, teacherQuestions } from '../schema/index.js';
import { insertTeacherNote } from './chunks.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import {
  iso,
  toTeacherQuestion,
  toTeacherQuestionForTeacher,
  type TeacherQuestionForTeacher,
} from './map.js';
import { bestGroup, type GroupCandidate } from './question-similarity.js';
import {
  IdSchema,
  parseArg,
  studentScope,
  teacherScope,
  type StudentScope,
  type TeacherScope,
} from './scope.js';

/** Largest page of questions. */
export const QUESTIONS_MAX_LIMIT = 200;
/** Most open questions `open` reads as grouping candidates (that teacher and agent only). */
const GROUPING_CANDIDATE_MAX = 200;
/** Most ids `similarIds` carries after merging the caller's with the rest of the group. */
const SIMILAR_IDS_MAX = 50;
/** Most groups `listGroupsForTeacher` returns. */
export const GROUPS_MAX_LIMIT = 100;
/** Most questions shown inside one group. */
export const GROUP_QUESTIONS_MAX = 20;
/** A hard cap on the open rows `listGroupsForTeacher` reads before grouping them in memory. */
const GROUPING_SCAN_MAX = 5000;

const ListOptions = z.strictObject({
  status: TeacherQuestionSchema.shape.status,
  limit: z.int().min(1).max(QUESTIONS_MAX_LIMIT),
});

const NewQuestion = z.strictObject({
  agentId: IdSchema,
  text: z
    .string()
    .max(LIMITS.turnTextMaxLength)
    .refine((t) => t.trim().length > 0, 'not empty'),
  moduleHint: TeacherQuestionSchema.shape.moduleHint,
  similarIds: z.array(IdSchema),
});

const GroupsOptions = z.strictObject({ limit: z.int().min(1).max(GROUPS_MAX_LIMIT) });

const AnswerInput = z.strictObject({
  questionId: IdSchema,
  moduleId: IdSchema,
  answer: z.string(),
  noteQuestion: z.string().optional(),
});

/** One group of the teacher's own similarly worded open questions (build plan § Ask the teacher 5). */
export interface TeacherQuestionGroup {
  groupId: string;
  count: number;
  oldestAt: string;
  questions: { id: string; text: string; createdAt: string }[];
}

/** What `answer` returns: counts only, never a student id (build plan § Ask the teacher 4). */
export interface AnswerResult {
  answered: number;
  students: number;
  threadMessages: number;
  noteChunkId: string;
  evalCaseId: string;
}

const common = {
  id: teacherQuestions.id,
  teacherId: teacherQuestions.teacherId,
  agentId: teacherQuestions.agentId,
  text: teacherQuestions.text,
  moduleHint: teacherQuestions.moduleHint,
  similarIds: teacherQuestions.similarIds,
  status: teacherQuestions.status,
  createdAt: teacherQuestions.createdAt,
  answeredAt: teacherQuestions.answeredAt,
};

/** A candidate row's effective group: its own `group_id`, or its own `id` when that is null. */
const effectiveGroup = (c: { id: string; groupId: string | null }) => c.groupId ?? c.id;

export function teacherQuestionsRepo(db: Db) {
  return {
    /**
     * The teacher's inbox: newest first. The asking student is never selected (the column is not
     * in the SELECT list), so the teacher can't see who asked.
     */
    async listForTeacher(
      scope: TeacherScope,
      options: { status: TeacherQuestion['status']; limit: number },
    ): Promise<TeacherQuestionForTeacher[]> {
      const method = 'teacherQuestions.listForTeacher';
      const { teacherId } = teacherScope(scope, method);
      const { status, limit } = parseArg(ListOptions, options, method);
      const rows = await db
        .select(common)
        .from(teacherQuestions)
        .where(and(eq(teacherQuestions.teacherId, teacherId), eq(teacherQuestions.status, status)))
        .orderBy(desc(teacherQuestions.createdAt), desc(teacherQuestions.id))
        .limit(limit);
      return rows.map((r) => toTeacherQuestionForTeacher(r, method));
    },

    /**
     * Opens a question from the scope's student to one of the scope's teacher's agents (another
     * teacher's agent is `not_found`). Every `similarIds` entry must be one of that teacher's
     * questions (`scope`).
     *
     * Task 5.10 (§ Ask the teacher 2, Q1): a new question is lexically grouped, inside this same
     * transaction, with that teacher's and that agent's own other **open** questions only —
     * `question-similarity.ts`'s `bestGroup`, never another teacher's or agent's rows, and never a
     * real similarity search (`teacherQuestionStoreFor.findSimilar` stays `[]`). `similar_ids`
     * becomes the caller's ids plus the other open members of the chosen group (at most
     * `SIMILAR_IDS_MAX` total). The agent row lock is `no key update` (not `key share`), so two
     * concurrent opens for one agent serialise through this grouping read instead of racing it.
     *
     * Insert-or-return-existing (task 3.17, migration 0011's partial unique index on
     * `(teacher_id, student_id, agent_id, md5(text))` where `status = 'open'`): the live (3.7)
     * attempt and commit's fallback (3.17) can both try to open "the same" question for one turn
     * (a timed-out live attempt may still land), so a second identical open converges on the
     * first row — `similarIds`, `moduleHint` and the group from a second, redundant call are
     * discarded; the first open's are kept.
     */
    async open(
      scope: StudentScope,
      input: { agentId: string; text: string; moduleHint?: string; similarIds: string[] },
    ): Promise<TeacherQuestion> {
      const method = 'teacherQuestions.open';
      const { studentId, teacherId } = studentScope(scope, method);
      const q = parseArg(NewQuestion, input, method);
      const callerSimilarIds = [...new Set(q.similarIds)];
      const id = randomUUID();
      const createdAt = new Date().toISOString();

      const row = await translateWrite(method, () =>
        db.transaction(async (tx) => {
          const [owner] = await tx
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.id, q.agentId), eq(agents.teacherId, teacherId)))
            .for('no key update');
          if (!owner) throw new RepositoryError('not_found', method);

          if (callerSimilarIds.length > 0) {
            const owned = await tx
              .select({ id: teacherQuestions.id })
              .from(teacherQuestions)
              .where(
                and(
                  eq(teacherQuestions.teacherId, teacherId),
                  inArray(teacherQuestions.id, callerSimilarIds),
                ),
              )
              .for('key share');
            if (owned.length !== callerSimilarIds.length) throw new RepositoryError('scope', method);
          }

          const candidates: GroupCandidate[] = await tx
            .select({
              id: teacherQuestions.id,
              text: teacherQuestions.text,
              groupId: teacherQuestions.groupId,
              createdAt: teacherQuestions.createdAt,
            })
            .from(teacherQuestions)
            .where(
              and(
                eq(teacherQuestions.teacherId, teacherId),
                eq(teacherQuestions.agentId, q.agentId),
                eq(teacherQuestions.status, 'open'),
              ),
            )
            .orderBy(desc(teacherQuestions.createdAt), desc(teacherQuestions.id))
            .limit(GROUPING_CANDIDATE_MAX);
          const groupId = bestGroup(q.text, candidates) ?? id;
          const otherMembers = candidates
            .filter((c) => effectiveGroup(c) === groupId)
            .map((c) => c.id);
          const similarIds = [...new Set([...callerSimilarIds, ...otherMembers])].slice(
            0,
            SIMILAR_IDS_MAX,
          );

          // Drizzle's onConflictDoNothing() only infers a conflict target from plain columns
          // (drizzle-orm/pg-core's PgInsertBase.onConflictDoNothing types `target` as
          // IndexColumn | IndexColumn[]), not an expression like migration 0011's `md5(text)`;
          // Postgres itself requires `ON CONFLICT`'s target to match the index expression
          // exactly (else `42P10 invalid_column_reference`), so this is a raw insert — with bare
          // (table-unqualified) column names via `sql.identifier` in both the column list and the
          // conflict target: an INSERT's column list and ON CONFLICT target both reject a
          // table-qualified name (`"teacher_questions"."id"`) with a plain syntax error (`42601`).
          const col = (c: { name: string }) => sql.identifier(c.name);
          await tx.execute(sql`
            insert into ${teacherQuestions}
              (${col(teacherQuestions.id)}, ${col(teacherQuestions.teacherId)},
               ${col(teacherQuestions.agentId)}, ${col(teacherQuestions.studentId)},
               ${col(teacherQuestions.text)}, ${col(teacherQuestions.moduleHint)},
               ${col(teacherQuestions.groupId)},
               ${col(teacherQuestions.similarIds)}, ${col(teacherQuestions.createdAt)})
            values (
              ${id}::text, ${teacherId}::text, ${q.agentId}::text, ${studentId}::text,
              ${q.text}::text, ${q.moduleHint ?? null}::text, ${groupId}::text,
              ${sql.param(similarIds)}::text[], ${createdAt}::timestamptz
            )
            on conflict (
              ${col(teacherQuestions.teacherId)}, ${col(teacherQuestions.studentId)},
              ${col(teacherQuestions.agentId)}, md5(${col(teacherQuestions.text)})
            ) where ${col(teacherQuestions.status)} = 'open'
            do nothing
          `);

          // Either the row this call just inserted, or the open row it collided with: the WHERE
          // below names exactly the dedup index's key (plus `status = 'open'`, its predicate), so
          // one of those two always matches; there is no third outcome to handle.
          const [existing] = await tx
            .select(common)
            .from(teacherQuestions)
            .where(
              and(
                eq(teacherQuestions.teacherId, teacherId),
                eq(teacherQuestions.studentId, studentId),
                eq(teacherQuestions.agentId, q.agentId),
                eq(teacherQuestions.text, q.text),
                eq(teacherQuestions.status, 'open'),
              ),
            )
            .limit(1);
          return existing!;
        }),
      );
      return toTeacherQuestion({ ...row, studentId }, method);
    },

    /** The scope's own questions to this teacher, newest first (at most 200). */
    async listForStudent(scope: StudentScope): Promise<TeacherQuestion[]> {
      const method = 'teacherQuestions.listForStudent';
      const { studentId, teacherId } = studentScope(scope, method);
      const rows = await db
        .select({ ...common, studentId: teacherQuestions.studentId })
        .from(teacherQuestions)
        .where(
          and(eq(teacherQuestions.studentId, studentId), eq(teacherQuestions.teacherId, teacherId)),
        )
        .orderBy(desc(teacherQuestions.createdAt), desc(teacherQuestions.id))
        .limit(QUESTIONS_MAX_LIMIT);
      return rows.map((r) => toTeacherQuestion(r, method));
    },

    /**
     * The teacher's open questions, grouped (task 5.10 Q1): biggest group first, then oldest.
     * Never selects `student_id`. Grouping happens in memory over the teacher's own open
     * questions (at most `GROUPING_SCAN_MAX`), the same `group_id` column `open` wrote.
     */
    async listGroupsForTeacher(
      scope: TeacherScope,
      options: { limit: number },
    ): Promise<TeacherQuestionGroup[]> {
      const method = 'teacherQuestions.listGroupsForTeacher';
      const { teacherId } = teacherScope(scope, method);
      const { limit } = parseArg(GroupsOptions, options, method);
      const rows = await db
        .select({
          id: teacherQuestions.id,
          text: teacherQuestions.text,
          groupId: teacherQuestions.groupId,
          createdAt: teacherQuestions.createdAt,
        })
        .from(teacherQuestions)
        .where(and(eq(teacherQuestions.teacherId, teacherId), eq(teacherQuestions.status, 'open')))
        .orderBy(desc(teacherQuestions.createdAt), desc(teacherQuestions.id))
        .limit(GROUPING_SCAN_MAX);

      const byGroup = new Map<string, { id: string; text: string; createdAt: Date }[]>();
      for (const r of rows) {
        const g = effectiveGroup(r);
        const list = byGroup.get(g) ?? [];
        list.push({ id: r.id, text: r.text, createdAt: r.createdAt });
        byGroup.set(g, list);
      }

      const groups: TeacherQuestionGroup[] = [...byGroup.entries()].map(([groupId, qs]) => {
        const sorted = [...qs].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1),
        );
        return {
          groupId,
          count: qs.length,
          oldestAt: iso(sorted[0]!.createdAt),
          questions: sorted
            .slice(0, GROUP_QUESTIONS_MAX)
            .map((x) => ({ id: x.id, text: x.text, createdAt: iso(x.createdAt) })),
        };
      });
      groups.sort(
        (a, b) =>
          b.count - a.count || new Date(a.oldestAt).getTime() - new Date(b.oldestAt).getTime(),
      );
      return groups.slice(0, limit);
    },

    /**
     * Answers the scope's own open question and every open question sharing its group, in one
     * transaction (task 5.10 § Ask the teacher 4). Already-answered, dismissed, another teacher's
     * or a missing question is `not_found` and nothing is written. Writes, in order:
     *   1. locks the target `FOR UPDATE`, then every open member of its group `FOR UPDATE`;
     *   2. one teacher note (`insertTeacherNote`, shared with `CorrectionStore`), so the note, the
     *      members' status and the student delivery commit together (plan decision 2);
     *   3. every member to `status 'answered'` with `answer` and `answered_at`;
     *   4. for each **distinct student** among the members (the earliest of their own member rows
     *      stands for them): one `teacher` message into that student's open session with this
     *      teacher and agent (0 or 1 row; no session is ever created or reopened), and one
     *      `notifications` row (unique on student and that question, so a retry is harmless).
     * Returns counts only — no student id ever leaves.
     */
    async answer(
      scope: TeacherScope,
      input: { questionId: string; moduleId: string; answer: string; noteQuestion?: string },
    ): Promise<AnswerResult> {
      const method = 'teacherQuestions.answer';
      const { teacherId } = teacherScope(scope, method);
      const i = parseArg(AnswerInput, input, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const [target] = await tx
            .select({
              id: teacherQuestions.id,
              groupId: teacherQuestions.groupId,
              text: teacherQuestions.text,
            })
            .from(teacherQuestions)
            .where(
              and(
                eq(teacherQuestions.id, i.questionId),
                eq(teacherQuestions.teacherId, teacherId),
                eq(teacherQuestions.status, 'open'),
              ),
            )
            .for('update');
          if (!target) throw new RepositoryError('not_found', method);
          const groupId = effectiveGroup(target);

          const members = await tx
            .select({
              id: teacherQuestions.id,
              studentId: teacherQuestions.studentId,
              agentId: teacherQuestions.agentId,
              createdAt: teacherQuestions.createdAt,
            })
            .from(teacherQuestions)
            .where(
              and(
                eq(teacherQuestions.teacherId, teacherId),
                eq(teacherQuestions.status, 'open'),
                sql`coalesce(${teacherQuestions.groupId}, ${teacherQuestions.id}) = ${groupId}`,
              ),
            )
            .for('update');

          const { chunkId: noteChunkId, evalCaseId } = await insertTeacherNote(
            tx,
            teacherId,
            {
              moduleId: i.moduleId,
              question: i.noteQuestion ?? target.text,
              answer: i.answer,
              origin: 'teacher_answer',
              teacherQuestionId: target.id,
            },
            method,
          );

          await tx
            .update(teacherQuestions)
            .set({ status: 'answered', answer: i.answer, answeredAt: sql`now()` })
            .where(
              inArray(
                teacherQuestions.id,
                members.map((m) => m.id),
              ),
            );

          // One member per distinct student stands for them below: the earliest (then lowest id)
          // of their own rows in this group.
          const byStudent = new Map<string, (typeof members)[number]>();
          for (const m of [...members].sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1),
          )) {
            if (!byStudent.has(m.studentId)) byStudent.set(m.studentId, m);
          }

          let threadMessages = 0;
          for (const [studentId, m] of byStudent) {
            const res = await tx.execute(
              insertSelect(
                messages,
                [
                  [messages.id, sql`${randomUUID()}::text`],
                  [messages.sessionId, sql`${sessions.id}`],
                  [messages.role, sql`'teacher'::message_role`],
                  [messages.text, sql`${i.answer}::text`],
                  [messages.sources, sql`null::jsonb`],
                  [messages.createdAt, sql`now()`],
                ],
                // `limit 1`: normally at most one open session matches, but nothing stops two
                // (for example a stale one a later package change never closed) — the insert
                // would otherwise try to write that one row's id twice and fail on the primary
                // key, so this picks the newest deterministically instead of depending on it.
                sql`from ${sessions} where ${sessions.teacherId} = ${teacherId}
                    and ${sessions.studentId} = ${studentId} and ${sessions.agentId} = ${m.agentId}
                    and ${sessions.endedAt} is null
                    order by ${sessions.createdAt} desc, ${sessions.id} desc limit 1`,
              ),
            );
            threadMessages += written(res);

            await tx
              .insert(notifications)
              .values({
                id: randomUUID(),
                studentId,
                teacherId,
                kind: 'teacher_answer',
                teacherQuestionId: m.id,
              })
              .onConflictDoNothing();
          }

          return {
            answered: members.length,
            students: byStudent.size,
            threadMessages,
            noteChunkId,
            evalCaseId,
          };
        }),
      );
    },

    /**
     * Closes the scope's own open question, alone (task 8.9 open question 1: `answer` is
     * deliberately group-wide because it writes one shared note that teaches every member;
     * `dismiss` writes nothing that benefits the rest of the group, so it never touches sibling
     * rows, the group id, or `answer`/`answered_at`). Another teacher's, a missing, or an
     * already-answered/dismissed question is `not_found` and nothing is written. Once dismissed
     * the row already drops out of `listForTeacher`'s and `listGroupsForTeacher`'s
     * `status = 'open'` queries, so no other table or column changes.
     */
    async dismiss(scope: TeacherScope, questionId: string): Promise<void> {
      const method = 'teacherQuestions.dismiss';
      const { teacherId } = teacherScope(scope, method);
      const id = parseArg(IdSchema, questionId, method);
      const [row] = await db
        .update(teacherQuestions)
        .set({ status: 'dismissed' })
        .where(
          and(
            eq(teacherQuestions.id, id),
            eq(teacherQuestions.teacherId, teacherId),
            eq(teacherQuestions.status, 'open'),
          ),
        )
        .returning({ id: teacherQuestions.id });
      if (!row) throw new RepositoryError('not_found', method);
    },
  };
}
