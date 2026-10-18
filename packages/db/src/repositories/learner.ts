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
import { parseArg, studentScope, type StudentScope } from './scope.js';

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
  };
}

const Events = z.array(EvidenceEventSchema);

/** Scored evidence (append-only). */
export function evidenceEventsRepo(db: Db) {
  return {
    /**
     * Appends events for the scope, all or nothing. An event naming another student or teacher,
     * or a topic that isn't the scope's teacher's, is `scope` and nothing is written.
     */
    async append(scope: StudentScope, events: EvidenceEvent[]): Promise<void> {
      const method = 'evidenceEvents.append';
      const sc = studentScope(scope, method);
      const list = parseArg(Events, events, method);
      if (!list.every((e) => sameScope(e, sc))) throw new RepositoryError('scope', method);
      if (list.length === 0) return;
      const topicIds = [...new Set(list.map((e) => e.topicId))];

      await translateWrite(method, () =>
        db.transaction(async (tx) => {
          const owned = await tx
            .select({ id: topics.id })
            .from(topics)
            .where(and(eq(topics.teacherId, sc.teacherId), inArray(topics.id, topicIds)))
            .for('key share');
          if (owned.length !== topicIds.length) throw new RepositoryError('scope', method);
          await tx.insert(evidenceEvents).values(
            list.map((e) => ({
              studentId: sc.studentId,
              teacherId: sc.teacherId,
              topicId: e.topicId,
              correct: e.correct,
              source: e.source,
              weight: e.weight,
              ts: new Date(e.ts),
            })),
          );
        }),
      );
    },
  };
}
