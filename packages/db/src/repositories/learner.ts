import {
  EvidenceEventSchema,
  LearnerProfileSchema,
  type EvidenceEvent,
  type LearnerProfile,
} from '@edmate/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { evidenceEvents, learnerProfiles, topics } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { toLearnerProfile } from './map.js';
import { IdSchema, parseArg, studentScope, type StudentScope } from './scope.js';

const sameScope = (x: { studentId: string; teacherId: string }, scope: StudentScope) =>
  x.studentId === scope.studentId && x.teacherId === scope.teacherId;

/** Learner profiles: one per student x teacher. */
export function learnerProfilesRepo(db: Db) {
  return {
    /** The scope's profile, or null if there is none yet. */
    async get(scope: StudentScope): Promise<LearnerProfile | null> {
      const method = 'learnerProfiles.get';
      const { studentId, teacherId } = studentScope(scope, method);
      const [row] = await db
        .select({
          studentId: learnerProfiles.studentId,
          teacherId: learnerProfiles.teacherId,
          lang: learnerProfiles.lang,
          mastery: learnerProfiles.mastery,
          mistakes: learnerProfiles.mistakes,
          lastSummary: learnerProfiles.lastSummary,
        })
        .from(learnerProfiles)
        .where(
          and(eq(learnerProfiles.teacherId, teacherId), eq(learnerProfiles.studentId, studentId)),
        )
        .limit(1);
      return row ? toLearnerProfile(row, method) : null;
    },

    /**
     * Creates or replaces the scope's profile. A profile naming another student or teacher is
     * `scope`; the upsert's conflict target is the scope's own (teacher_id, student_id) row.
     */
    async save(scope: StudentScope, profile: LearnerProfile): Promise<void> {
      const method = 'learnerProfiles.save';
      const sc = studentScope(scope, method);
      const p = parseArg(LearnerProfileSchema, profile, method);
      if (!sameScope(p, sc)) throw new RepositoryError('scope', method);
      const fields = {
        lang: p.lang,
        mastery: p.mastery,
        mistakes: p.mistakes,
        lastSummary: p.lastSummary ?? null,
      };
      await translateWrite(method, () =>
        db
          .insert(learnerProfiles)
          .values({ studentId: sc.studentId, teacherId: sc.teacherId, ...fields })
          .onConflictDoUpdate({
            target: [learnerProfiles.teacherId, learnerProfiles.studentId],
            set: { ...fields, updatedAt: sql`now()` },
          }),
      );
    },

    /**
     * Merges `patch` (topic id -> mastery entry) into the scope's profile, creating it (lang `en`,
     * empty mistakes — task 3.17's new-profile default; locale work may revisit) when none exists
     * yet. Every topic in `patch` must be the scope's teacher's, else `scope` (nothing written) —
     * defense in depth: the only caller (`profileStoreFor.applyEvidence`) already derives `patch`
     * from `evidenceEvents.append`'s own ownership-checked return, so this never rejects there, but
     * this method has no other way to tell a borrowed topic id from an owned one.
     *
     * The `SET` list only ever names `mastery` (merged with Postgres's jsonb `||`, so topics not in
     * `patch` are untouched) and `updated_at`: `mistakes` and `last_summary` are never in this
     * statement, so this write can never clobber `last_summary` (closes the 3.16 review's deferred
     * finding for this write path; `save()`'s own semantics are unchanged, still 6.4's job). An
     * empty patch writes nothing.
     */
    async applyMastery(scope: StudentScope, patch: LearnerProfile['mastery']): Promise<void> {
      const method = 'learnerProfiles.applyMastery';
      const sc = studentScope(scope, method);
      const p = parseArg(LearnerProfileSchema.shape.mastery, patch, method);
      const topicIds = Object.keys(p);
      if (topicIds.length === 0) return;
      await translateWrite(method, () =>
        db.transaction(async (tx) => {
          const owned = await tx
            .select({ id: topics.id })
            .from(topics)
            .where(and(eq(topics.teacherId, sc.teacherId), inArray(topics.id, topicIds)))
            .for('key share');
          if (owned.length !== topicIds.length) throw new RepositoryError('scope', method);
          await tx
            .insert(learnerProfiles)
            .values({
              studentId: sc.studentId,
              teacherId: sc.teacherId,
              lang: 'en',
              mastery: p,
              mistakes: [],
            })
            .onConflictDoUpdate({
              target: [learnerProfiles.teacherId, learnerProfiles.studentId],
              set: {
                mastery: sql`${learnerProfiles.mastery} || ${JSON.stringify(p)}::jsonb`,
                updatedAt: sql`now()`,
              },
            });
        }),
      );
    },
  };
}

/** A would-be `evidence_events` row: the contract plus an optional explicit id (below). */
const EventWithId = EvidenceEventSchema.extend({ id: IdSchema.optional() });
export type EvidenceEventEntry = z.infer<typeof EventWithId>;
const EventsWithId = z.array(EventWithId);

function toEvidenceEvent(
  row: {
    studentId: string;
    teacherId: string;
    topicId: string;
    correct: boolean;
    source: string;
    weight: number;
    ts: Date;
  },
  method: string,
): EvidenceEvent {
  return parseArg(EvidenceEventSchema, { ...row, ts: row.ts.toISOString() }, method);
}

/** Scored evidence (append-only). */
export function evidenceEventsRepo(db: Db) {
  return {
    /**
     * Appends events for the scope, all or nothing, and returns the ones actually written (the
     * contract shape, without `id`). An event naming another student or teacher, or a topic that
     * isn't the scope's teacher's, is `scope` and nothing is written.
     *
     * Idempotency (task 3.17): an event carrying `id` (the queue producer's content hash of
     * studentId|teacherId|topicId|correct|source|weight|its *original* ts — see
     * `packages/queue/src/queues.ts`'s `evidenceEventId`) that already exists is silently skipped
     * (`ON CONFLICT (id) DO NOTHING`, so a replayed job, or the same evidence fed twice, inserts
     * its row once) and is left out of the returned list — `profileStoreFor.applyEvidence` only
     * folds BKT updates for events this call actually wrote, so a replay changes mastery once too.
     * An event with no `id` always gets a fresh one (never deduplicated).
     */
    async append(scope: StudentScope, events: EvidenceEventEntry[]): Promise<EvidenceEvent[]> {
      const method = 'evidenceEvents.append';
      const sc = studentScope(scope, method);
      const list = parseArg(EventsWithId, events, method);
      if (!list.every((e) => sameScope(e, sc))) throw new RepositoryError('scope', method);
      if (list.length === 0) return [];
      const topicIds = [...new Set(list.map((e) => e.topicId))];

      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const owned = await tx
            .select({ id: topics.id })
            .from(topics)
            .where(and(eq(topics.teacherId, sc.teacherId), inArray(topics.id, topicIds)))
            .for('key share');
          if (owned.length !== topicIds.length) throw new RepositoryError('scope', method);
          const rows = await tx
            .insert(evidenceEvents)
            .values(
              list.map((e) => ({
                ...(e.id === undefined ? {} : { id: e.id }),
                studentId: sc.studentId,
                teacherId: sc.teacherId,
                topicId: e.topicId,
                correct: e.correct,
                source: e.source,
                weight: e.weight,
                ts: new Date(e.ts),
              })),
            )
            .onConflictDoNothing({ target: evidenceEvents.id })
            .returning({
              studentId: evidenceEvents.studentId,
              teacherId: evidenceEvents.teacherId,
              topicId: evidenceEvents.topicId,
              correct: evidenceEvents.correct,
              source: evidenceEvents.source,
              weight: evidenceEvents.weight,
              ts: evidenceEvents.ts,
            });
          return rows.map((r) => toEvidenceEvent(r, method));
        }),
      );
    },
  };
}
