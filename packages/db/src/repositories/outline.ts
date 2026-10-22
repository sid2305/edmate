// Task 8.3: the studio outline. A teacher's course, its modules (rename and reorder only) and their
// topics (rename, reorder, merge, split), each topic with its source links (`topic_chunks`). Every
// read and write carries the scope's teacher_id; a write names a set of modules and topics that
// must all be the teacher's, locked in one transaction before anything is written (README rule 3).
// Chunk-table SQL lives in chunks.ts (`insertTopicLinks`, `topicSources`): only that file and
// retrieval.ts may name the chunks table (test/access-audit.test.ts, rule 1).
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { courses, evidenceEvents, modules, topicChunks, topics } from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { insertTopicLinks, type TopicLinkInput, topicSources } from './chunks.js';
import { RepositoryError, translateWrite } from './errors.js';
import { type CourseRow, type Outline, toCourseRow, toOutline } from './map.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The title `courses.ensureDefault` gives a teacher's first course. */
export const DEFAULT_COURSE_TITLE = 'My course';
/** The title `courses.ensureDefault` gives a teacher's first module. */
export const DEFAULT_MODULE_TITLE = 'Module 1';
/** Most modules one `outline.replaceOutline` call names. */
export const OUTLINE_MODULES_MAX = 100;
/** Most topics in one module of a `replaceOutline` input. */
export const OUTLINE_TOPICS_MAX = 200;
/** Most source links on one topic. */
export const TOPIC_CHUNKS_MAX = 500;
/** Longest module or topic title. */
export const OUTLINE_TITLE_MAX_LENGTH = 200;

const TitleSchema = z.string().trim().min(1).max(OUTLINE_TITLE_MAX_LENGTH);
const OrderSchema = z.int().min(0).max(10_000);
const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

const TopicInputSchema = z.strictObject({
  /** An existing topic of one of the named modules; absent for a new topic (a split's new half). */
  id: IdSchema.optional(),
  title: TitleSchema,
  order: OrderSchema,
  chunkIds: z.array(IdSchema).max(TOPIC_CHUNKS_MAX).refine(unique),
});

const ModuleInputSchema = z.strictObject({
  id: IdSchema,
  title: TitleSchema,
  order: OrderSchema,
  topics: z.array(TopicInputSchema).max(OUTLINE_TOPICS_MAX),
});

const OutlineInputSchema = z
  .strictObject({ modules: z.array(ModuleInputSchema).min(1).max(OUTLINE_MODULES_MAX) })
  .refine((o) => unique(o.modules.map((m) => m.id)))
  .refine((o) => unique(o.modules.flatMap((m) => m.topics.flatMap((t) => t.id ?? []))));

/**
 * The whole edited tree of some of the teacher's modules (one course). Each named module's topic
 * set becomes exactly `topics`: a listed id is kept (renamed, reordered, possibly moved to another
 * named module, its links replaced), a topic without an id is created, and a topic of a named
 * module that is not listed is deleted (a merge's absorbed half).
 */
export type OutlineInput = z.infer<typeof OutlineInputSchema>;

/** The scope's first course (MVP: one course per teacher), or none. */
async function firstCourse(db: Pick<Db, 'select'>, teacherId: string) {
  const [row] = await db
    .select({ id: courses.id, title: courses.title, outlineVersion: courses.outlineVersion })
    .from(courses)
    .where(eq(courses.teacherId, teacherId))
    .orderBy(asc(courses.order), asc(courses.createdAt), asc(courses.id))
    .limit(1);
  return row;
}

/** Module and topic counts of one of the scope's courses, for the audit row (counts only). */
async function shape(tx: Tx, teacherId: string, courseId: string) {
  const [m] = await tx
    .select({ n: count() })
    .from(modules)
    .where(and(eq(modules.teacherId, teacherId), eq(modules.courseId, courseId)));
  const [t] = await tx
    .select({ n: count() })
    .from(topics)
    .innerJoin(modules, and(eq(modules.id, topics.moduleId), eq(modules.teacherId, teacherId)))
    .where(and(eq(topics.teacherId, teacherId), eq(modules.courseId, courseId)));
  return { moduleCount: m?.n ?? 0, topicCount: t?.n ?? 0 };
}

export function coursesRepo(db: Db) {
  return {
    /** The scope's course (the first, by order), or null. Never inserts. */
    async get(scope: TeacherScope): Promise<CourseRow | null> {
      const method = 'courses.get';
      const { teacherId } = teacherScope(scope, method);
      const row = await firstCourse(db, teacherId);
      return row ? toCourseRow(row, method) : null;
    },

    /**
     * The scope's course, created first when the teacher has none ("My course"); and, when the
     * teacher has no module at all, one "Module 1" in it, in the same transaction. Idempotent: a
     * per-teacher transaction lock makes concurrent calls create one course and one module. A
     * scope id that is not a user is `not_found`.
     */
    async ensureDefault(scope: TeacherScope): Promise<CourseRow> {
      const method = 'courses.ensureDefault';
      const { teacherId } = teacherScope(scope, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`outline:${teacherId}`}::text, 0))`,
          );
          const course = toCourseRow(
            (await firstCourse(tx, teacherId)) ??
              (
                await tx
                  .insert(courses)
                  .values({ id: randomUUID(), teacherId, title: DEFAULT_COURSE_TITLE, order: 0 })
                  .returning({
                    id: courses.id,
                    title: courses.title,
                    outlineVersion: courses.outlineVersion,
                  })
              )[0],
            method,
          );
          const [anyModule] = await tx
            .select({ id: modules.id })
            .from(modules)
            .where(eq(modules.teacherId, teacherId))
            .limit(1);
          if (!anyModule) {
            await tx.insert(modules).values({
              id: randomUUID(),
              teacherId,
              courseId: course.id,
              title: DEFAULT_MODULE_TITLE,
              order: 0,
            });
          }
          return course;
        }),
      );
    },
  };
}

export function outlineRepo(db: Db) {
  return {
    /**
     * The scope's outline: its course's modules (by order, then id), each module's topics (same)
     * and each topic's source links (`chunkId`, `sourceTitle`, `locator`; never chunk text).
     * Null when the teacher has no course yet.
     */
    async getOutline(scope: TeacherScope): Promise<Outline | null> {
      const method = 'outline.getOutline';
      const { teacherId } = teacherScope(scope, method);
      const course = await firstCourse(db, teacherId);
      if (!course) return null;
      const mods = await db
        .select({ id: modules.id, title: modules.title, order: modules.order })
        .from(modules)
        .where(and(eq(modules.teacherId, teacherId), eq(modules.courseId, course.id)))
        .orderBy(asc(modules.order), asc(modules.id));
      // An empty list is `false` in Drizzle's inArray: a course with no modules reads no topics.
      const tops = await db
        .select({
          id: topics.id,
          moduleId: topics.moduleId,
          title: topics.title,
          order: topics.order,
        })
        .from(topics)
        .where(
          and(
            eq(topics.teacherId, teacherId),
            inArray(
              topics.moduleId,
              mods.map((m) => m.id),
            ),
          ),
        )
        .orderBy(asc(topics.order), asc(topics.id));
      const sources = await topicSources(
        db,
        teacherId,
        tops.map((t) => t.id),
      );
      return toOutline(
        {
          courseId: course.id,
          outlineVersion: course.outlineVersion,
          modules: mods.map((m) => ({
            id: m.id,
            title: m.title,
            order: m.order,
            topics: tops
              .filter((t) => t.moduleId === m.id)
              .map((t) => ({
                id: t.id,
                title: t.title,
                order: t.order,
                chunkIds: sources
                  .filter((s) => s.topicId === t.id)
                  .map((s) => ({
                    chunkId: s.chunkId,
                    sourceTitle: s.sourceTitle,
                    locator: s.locator,
                  })),
              })),
          })),
        },
        method,
      );
    },

    /**
     * Writes the edited tree of the named modules (see OutlineInput) in one transaction: locks the
     * scope's courses, then the named modules (any not the scope's is `not_found`; modules of more
     * than one course are `invalid`), then those modules' topics (a listed topic id that is not
     * one of them is `not_found`). A topic that would be deleted but has student evidence
     * (`evidence_events`) is `invalid`: student data is never deleted by an outline edit. Links are
     * written with every chunk id checked against the teacher's own chunks in the same statement
     * (an unknown or another teacher's chunk is `invalid`). Then the course's `outline_version` is
     * bumped by 1 and one `outline.edit` audit row (counts only) is written. Any failure writes
     * nothing.
     */
    async replaceOutline(
      scope: TeacherScope,
      input: OutlineInput,
    ): Promise<{ courseId: string; outlineVersion: number }> {
      const method = 'outline.replaceOutline';
      const { teacherId } = teacherScope(scope, method);
      const o = parseArg(OutlineInputSchema, input, method);
      const moduleIds = o.modules.map((m) => m.id);
      const keptIds = o.modules.flatMap((m) => m.topics.flatMap((t) => t.id ?? []));
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          // Lock order: courses, modules, topics (each by id), so concurrent edits can't deadlock.
          const owned = await tx
            .select({ id: courses.id, outlineVersion: courses.outlineVersion })
            .from(courses)
            .where(eq(courses.teacherId, teacherId))
            .orderBy(asc(courses.id))
            .for('update');
          const mods = await tx
            .select({ id: modules.id, courseId: modules.courseId })
            .from(modules)
            .where(and(eq(modules.teacherId, teacherId), inArray(modules.id, moduleIds)))
            .orderBy(asc(modules.id))
            .for('update');
          if (mods.length !== moduleIds.length) throw new RepositoryError('not_found', method);
          const courseIds = new Set(mods.map((m) => m.courseId));
          if (courseIds.size !== 1) throw new RepositoryError('invalid', method);
          // A module filed under a course that is not the scope's (only by bad data) is refused.
          const course = owned.find((c) => courseIds.has(c.id));
          if (!course) throw new RepositoryError('not_found', method);
          const courseId = course.id;
          const outlineVersion = course.outlineVersion + 1;
          const existing = await tx
            .select({ id: topics.id })
            .from(topics)
            .where(and(eq(topics.teacherId, teacherId), inArray(topics.moduleId, moduleIds)))
            .orderBy(asc(topics.id))
            .for('update');
          const existingIds = new Set(existing.map((t) => t.id));
          if (keptIds.some((id) => !existingIds.has(id))) {
            throw new RepositoryError('not_found', method);
          }
          const before = await shape(tx, teacherId, courseId);

          const kept = new Set(keptIds);
          const dropped = existing.map((t) => t.id).filter((id) => !kept.has(id));
          if (dropped.length > 0) {
            const [studied] = await tx
              .select({ id: evidenceEvents.id })
              .from(evidenceEvents)
              .where(
                and(
                  eq(evidenceEvents.teacherId, teacherId),
                  inArray(evidenceEvents.topicId, dropped),
                ),
              )
              .limit(1);
            if (studied) throw new RepositoryError('invalid', method);
            // Cascades to the dropped topics' topic_chunks rows.
            await tx
              .delete(topics)
              .where(
                and(
                  eq(topics.teacherId, teacherId),
                  inArray(topics.moduleId, moduleIds),
                  inArray(topics.id, dropped),
                ),
              );
          }
          if (keptIds.length > 0) {
            await tx
              .delete(topicChunks)
              .where(
                and(eq(topicChunks.teacherId, teacherId), inArray(topicChunks.topicId, keptIds)),
              );
          }

          const links: TopicLinkInput[] = [];
          for (const m of o.modules) {
            await tx
              .update(modules)
              .set({ title: m.title, order: m.order, updatedAt: sql`now()` })
              .where(and(eq(modules.id, m.id), eq(modules.teacherId, teacherId)));
            for (const t of m.topics) {
              const topicId = t.id ?? randomUUID();
              if (t.id === undefined) {
                await tx.insert(topics).values({
                  id: topicId,
                  teacherId,
                  moduleId: m.id,
                  title: t.title,
                  order: t.order,
                });
              } else {
                await tx
                  .update(topics)
                  .set({ moduleId: m.id, title: t.title, order: t.order, updatedAt: sql`now()` })
                  .where(and(eq(topics.id, topicId), eq(topics.teacherId, teacherId)));
              }
              t.chunkIds.forEach((chunkId, order) => links.push({ topicId, chunkId, order }));
            }
          }
          if ((await insertTopicLinks(tx, teacherId, links)) !== links.length) {
            throw new RepositoryError('invalid', method);
          }

          // The course row is locked above, so its version can't move under this transaction.
          await tx
            .update(courses)
            .set({ outlineVersion, updatedAt: sql`now()` })
            .where(and(eq(courses.id, courseId), eq(courses.teacherId, teacherId)));
          const after = await shape(tx, teacherId, courseId);
          await insertAuditEntry(tx, method, teacherId, null, {
            actor: teacherId,
            actorRole: 'teacher',
            action: 'outline.edit',
            target: `course:${courseId}`,
            before: { outlineVersion: course.outlineVersion, ...before },
            after: { outlineVersion, ...after },
          });
          return { courseId, outlineVersion };
        }),
      );
    },
  };
}
