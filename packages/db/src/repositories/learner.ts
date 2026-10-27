import { debuglog } from 'node:util';
import {
  EvidenceEventSchema,
  LearnerProfileSchema,
  type EvidenceEvent,
  type LearnerProfile,
} from '@edmate/contracts';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { foldMastery } from '../mastery.js';
import { evidenceEvents, learnerProfiles, sessions, topics } from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { RepositoryError, translateWrite } from './errors.js';
import { written } from './insert.js';
import { toLearnerProfile } from './map.js';
import { IdSchema, parseArg, studentScope, type StudentScope } from './scope.js';

/** Largest page `evidenceEvents.list` returns; a bigger `limit` is `invalid`. */
export const EVIDENCE_LIST_MAX = 10_000;

const debug = debuglog('edmate:db');

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

    /**
     * Task 6.3: merges `patch` (the `known` output of `classifyMistakeTags`,
     * `packages/harness/src/memory/mistakeTags.ts`) into the scope's `mistakes` jsonb array, under
     * a row lock so two concurrent calls for the same pair can never both read the same prior
     * mistakes and clobber each other (same lost-update concern `applyEvidenceMastery` already
     * guards for `mastery`). By tag: a tag already present has its `count` summed and `lastSeen`
     * replaced with whichever of the two is later; a tag not yet present is appended. There is no
     * event log to replay here (unlike `applyEvidenceMastery`/`rebuildMastery`) — just a merge,
     * same shape as `applyMastery`.
     *
     * The `SET` list only ever names `mistakes` and `updated_at` (never `mastery`/`last_summary`),
     * same narrow-write discipline `applyMastery`'s own doc comment requires of itself. No topic-
     * ownership check: a mistake tag is not a topic id, and `classifyMistakeTags` has already
     * guaranteed every `patch` entry's tag is a member of the caller-supplied allowed list (the
     * style card's `mistakeTags`) before this is ever called — this method only merges, it does not
     * re-validate "on the teacher's list" (that invariant lives in the pure classifier, not here).
     * An empty `patch` is a no-op.
     */
    async applyMistakes(scope: StudentScope, patch: LearnerProfile['mistakes']): Promise<void> {
      const method = 'learnerProfiles.applyMistakes';
      const sc = studentScope(scope, method);
      const p = parseArg(LearnerProfileSchema.shape.mistakes, patch, method);
      if (p.length === 0) return;
      await translateWrite(method, () =>
        db.transaction(async (tx) => {
          await tx
            .insert(learnerProfiles)
            .values({
              studentId: sc.studentId,
              teacherId: sc.teacherId,
              lang: 'en',
              mastery: {},
              mistakes: [],
            })
            .onConflictDoNothing({
              target: [learnerProfiles.teacherId, learnerProfiles.studentId],
            });

          // The insert above guarantees this row exists (freshly inserted, or already there):
          // the select always finds exactly one, now locked against any other transaction.
          const [locked] = await tx
            .select({ mistakes: learnerProfiles.mistakes })
            .from(learnerProfiles)
            .where(
              and(
                eq(learnerProfiles.teacherId, sc.teacherId),
                eq(learnerProfiles.studentId, sc.studentId),
              ),
            )
            .for('update');
          /* v8 ignore next */
          if (!locked) throw new RepositoryError('scope', method);

          const byTag = new Map(locked.mistakes.map((m) => [m.tag, { ...m }]));
          for (const entry of p) {
            const existing = byTag.get(entry.tag);
            if (existing) {
              existing.count += entry.count;
              if (entry.lastSeen > existing.lastSeen) existing.lastSeen = entry.lastSeen;
            } else {
              byTag.set(entry.tag, { ...entry });
            }
          }
          const next = [...byTag.values()];

          await tx
            .update(learnerProfiles)
            .set({ mistakes: next, updatedAt: sql`now()` })
            .where(
              and(
                eq(learnerProfiles.teacherId, sc.teacherId),
                eq(learnerProfiles.studentId, sc.studentId),
              ),
            );
        }),
      );
    },

    /**
     * Review fix round (3.17): folds `events` (already deduplicated and topic-scoped by the only
     * caller, `profileStoreFor.applyEvidence`) into the scope's mastery under a row lock, so two
     * concurrent calls for the same pair can never both read the same prior mastery and clobber
     * each other (a lost update) — unlike computing the fold in application code from a plain
     * `get()` and merging it back with `applyMastery` (the previous shape of this path). The scope
     * and topic-ownership checks stay inside the same transaction as the lock and the fold:
     * - a default row (lang `en`, empty mastery/mistakes) is inserted first if none exists yet
     *   (`ON CONFLICT DO NOTHING`, so a second concurrent caller never errors on it);
     * - the row is then locked (`SELECT ... FOR UPDATE`), so a second concurrent caller's own
     *   insert-or-lock blocks until the first transaction commits;
     * - the fold reads only that locked value, and the `UPDATE` replaces `mastery` wholesale with
     *   the fold's result (which already carries every untouched topic forward unchanged), still
     *   never touching `mistakes` or `last_summary`.
     * An empty `events` is a no-op.
     */
    async applyEvidenceMastery(
      scope: StudentScope,
      events: readonly { topicId: string; correct: boolean; ts: string }[],
    ): Promise<void> {
      const method = 'learnerProfiles.applyEvidenceMastery';
      const sc = studentScope(scope, method);
      if (events.length === 0) return;
      const topicIds = [...new Set(events.map((e) => e.topicId))];
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
              mastery: {},
              mistakes: [],
            })
            .onConflictDoNothing({
              target: [learnerProfiles.teacherId, learnerProfiles.studentId],
            });

          // The insert above guarantees this row exists (freshly inserted, or already there):
          // the select always finds exactly one, now locked against any other transaction.
          const [locked] = await tx
            .select({ mastery: learnerProfiles.mastery })
            .from(learnerProfiles)
            .where(
              and(
                eq(learnerProfiles.teacherId, sc.teacherId),
                eq(learnerProfiles.studentId, sc.studentId),
              ),
            )
            .for('update');

          const next = foldMastery(locked!.mastery, events);

          await tx
            .update(learnerProfiles)
            .set({ mastery: next, updatedAt: sql`now()` })
            .where(
              and(
                eq(learnerProfiles.teacherId, sc.teacherId),
                eq(learnerProfiles.studentId, sc.studentId),
              ),
            );
        }),
      );
    },

    /**
     * Task 6.2: discards whatever `mastery` is currently stored and recomputes it from scratch by
     * replaying the scope's *complete* `evidence_events` history, ordered `ts ASC, id ASC` (the
     * id tie-break makes same-timestamp events deterministic, same convention as 6.1's
     * `topicOrder`). Unlike `applyEvidenceMastery` (which folds only newly-appended events onto
     * whatever is already stored), this folds every event the scope has ever produced onto an
     * *empty* mastery map — so it also recovers from a corrupted/stale stored value, and a rebuild
     * can never be confused with an incremental apply. Same row-lock pattern as
     * `applyEvidenceMastery`: a concurrent `applyEvidence` and a rebuild for the same scope can
     * never interleave a partial read. Always uses `BKT_DEFAULTS` (no `BktParams` override — see
     * docs/tasks/6.2/plan.md Q3). Returns the rebuilt profile, same shape `get()` returns.
     */
    async rebuildMastery(scope: StudentScope): Promise<LearnerProfile> {
      const method = 'learnerProfiles.rebuildMastery';
      const sc = studentScope(scope, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          await tx
            .insert(learnerProfiles)
            .values({
              studentId: sc.studentId,
              teacherId: sc.teacherId,
              lang: 'en',
              mastery: {},
              mistakes: [],
            })
            .onConflictDoNothing({
              target: [learnerProfiles.teacherId, learnerProfiles.studentId],
            });

          // The insert above guarantees this row exists (freshly inserted, or already there):
          // the select always finds exactly one, now locked against any other transaction.
          const [locked] = await tx
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
              and(
                eq(learnerProfiles.teacherId, sc.teacherId),
                eq(learnerProfiles.studentId, sc.studentId),
              ),
            )
            .for('update');
          /* v8 ignore next */
          if (!locked) throw new RepositoryError('scope', method);

          const rows = await tx
            .select({
              topicId: evidenceEvents.topicId,
              correct: evidenceEvents.correct,
              ts: evidenceEvents.ts,
            })
            .from(evidenceEvents)
            .where(
              and(
                eq(evidenceEvents.teacherId, sc.teacherId),
                eq(evidenceEvents.studentId, sc.studentId),
              ),
            )
            .orderBy(asc(evidenceEvents.ts), asc(evidenceEvents.id));

          const next = foldMastery(
            {},
            rows.map((r) => ({ topicId: r.topicId, correct: r.correct, ts: r.ts.toISOString() })),
          );

          await tx
            .update(learnerProfiles)
            .set({ mastery: next, updatedAt: sql`now()` })
            .where(
              and(
                eq(learnerProfiles.teacherId, sc.teacherId),
                eq(learnerProfiles.studentId, sc.studentId),
              ),
            );

          return toLearnerProfile({ ...locked, mastery: next }, method);
        }),
      );
    },

    /**
     * Task 6.5: the student's own "reset what my tutor remembers". One transaction, in a lock
     * order that matches `sessions.end` (sessions, then the profile row), so the two can never
     * deadlock (40P01):
     * 1. Ends every one of the pair's still-open sessions (no summary written, so a later
     *    `sessions.end`/`endOnPackageChange` on one of them is a no-op that can't re-seed
     *    `last_summary`).
     * 2. Locks the profile row (`FOR UPDATE`). No row at all is `{ reset: false }` — step 1 still
     *    ran, but nothing else is written: no evidence delete, no audit row.
     * 3. Deletes the pair's `evidence_events` (the one delete this file is allowed, pinned by
     *    `test/scope.test.ts`): keeping them would let `rebuildMastery` bring the mastery back.
     * 4. Clears `mastery` to `{}`, `mistakes` to `[]` and `last_summary` to null. `lang` is kept:
     *    it is a setting, not memory.
     * 5. Writes one `profile.reset` audit row (actor the scope's own student) with before/after
     *    **counts and booleans only** — never the summary text or tag names (the redactor does
     *    not catch free text; this is why the shape here is counts, not content).
     * Deleting the row instead of clearing it in place is unsafe: every other writer in this file
     * inserts a default row, then locks it, and throws `scope` if it has vanished underneath it —
     * a delete racing one of those would turn a normal write into a spurious error.
     */
    async reset(scope: StudentScope): Promise<{ reset: boolean }> {
      const method = 'learnerProfiles.reset';
      const sc = studentScope(scope, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const endedSessions = await tx
            .update(sessions)
            .set({ endedAt: sql`now()` })
            .where(
              and(
                eq(sessions.teacherId, sc.teacherId),
                eq(sessions.studentId, sc.studentId),
                isNull(sessions.endedAt),
              ),
            );

          const [locked] = await tx
            .select({
              id: learnerProfiles.id,
              mastery: learnerProfiles.mastery,
              mistakes: learnerProfiles.mistakes,
              lastSummary: learnerProfiles.lastSummary,
            })
            .from(learnerProfiles)
            .where(
              and(
                eq(learnerProfiles.teacherId, sc.teacherId),
                eq(learnerProfiles.studentId, sc.studentId),
              ),
            )
            .for('update');
          if (!locked) return { reset: false };

          const deleted = await tx
            .delete(evidenceEvents)
            .where(
              and(
                eq(evidenceEvents.teacherId, sc.teacherId),
                eq(evidenceEvents.studentId, sc.studentId),
              ),
            )
            .returning({ id: evidenceEvents.id });

          await tx
            .update(learnerProfiles)
            .set({
              mastery: {},
              mistakes: [],
              lastSummary: null,
              memoryResetAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(learnerProfiles.teacherId, sc.teacherId),
                eq(learnerProfiles.studentId, sc.studentId),
              ),
            );

          await insertAuditEntry(tx, method, sc.teacherId, sc.studentId, {
            actor: sc.studentId,
            actorRole: 'student',
            action: 'profile.reset',
            target: `learner_profile:${locked.id}`,
            before: {
              topics: Object.keys(locked.mastery).length,
              mistakes: locked.mistakes.length,
              hadSummary: locked.lastSummary !== null,
              evidence: deleted.length,
              sessionsEnded: written(endedSessions),
            },
            after: { topics: 0, mistakes: 0, hadSummary: false, evidence: 0 },
          });

          return { reset: true };
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

/**
 * Task 6.5a: drops any entry whose `ts` is strictly before `resetAt` (a pair that was never
 * reset has `resetAt === null`, so nothing is dropped). Shared by `append` and `appendAndFold`,
 * both of which call this with the profile row already locked.
 */
function dropBeforeReset<T extends { ts: string }>(list: T[], resetAt: Date | null): T[] {
  if (resetAt === null) return list;
  const watermark = resetAt.getTime();
  return list.filter((e) => new Date(e.ts).getTime() >= watermark);
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
     *
     * Task 6.5a: locks the pair's `learner_profiles` row (inserting a default row first, `ON
     * CONFLICT DO NOTHING`) *before* inserting events — same lock order and reason
     * `appendAndFold` already uses (6.5 review MEDIUM: this method had never taken the lock,
     * even though it writes into the same event history `rebuildMastery` replays). Any event
     * whose `ts` is strictly before the locked `memory_reset_at` (when set) is dropped before the
     * insert, so a job queued before a reset can never re-seed the pair's evidence history.
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

          await tx
            .insert(learnerProfiles)
            .values({
              studentId: sc.studentId,
              teacherId: sc.teacherId,
              lang: 'en',
              mastery: {},
              mistakes: [],
            })
            .onConflictDoNothing({
              target: [learnerProfiles.teacherId, learnerProfiles.studentId],
            });

          // Locked *before* the events are inserted — same order as `appendAndFold`.
          const [locked] = await tx
            .select({ memoryResetAt: learnerProfiles.memoryResetAt })
            .from(learnerProfiles)
            .where(
              and(
                eq(learnerProfiles.teacherId, sc.teacherId),
                eq(learnerProfiles.studentId, sc.studentId),
              ),
            )
            .for('update');
          /* v8 ignore next */
          if (!locked) throw new RepositoryError('scope', method);

          const survivors = dropBeforeReset(list, locked.memoryResetAt);
          if (survivors.length < list.length) {
            debug(
              '%s: reset watermark dropped %d of %d event(s) for %s/%s',
              method,
              list.length - survivors.length,
              list.length,
              sc.teacherId,
              sc.studentId,
            );
          }
          if (survivors.length === 0) return [];

          const rows = await tx
            .insert(evidenceEvents)
            .values(
              survivors.map((e) => ({
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

    /**
     * Fix round 1 (6.2): `append` and `applyEvidenceMastery`, combined into **one** transaction —
     * the gap between those two calls (each its own transaction, in the old shape of
     * `profileStoreFor.applyEvidence`) let a concurrent `rebuildMastery` read the newly-committed
     * event (from `append`) before `applyEvidenceMastery` had folded it, so the rebuild's full
     * replay already counted it and the incremental fold then counted it again — a double-count,
     * not prevented by the row lock the two calls didn't share.
     *
     * Lock order matches every existing method in this file (topics, `key share`, before
     * `learner_profiles`, `for update`) so this can never deadlock (40P01) against
     * `applyMastery`/`applyEvidenceMastery`/`rebuildMastery`: this locks the `learner_profiles` row
     * *before* inserting the events, so a concurrent `rebuildMastery` — which also locks that row
     * first, then reads `evidence_events` — fully serialises against this transaction: either it
     * runs entirely before this one's event insert is visible (rebuild sees the old history only),
     * or entirely after this one commits (rebuild sees the new events *and* the fold already
     * applied them — rebuild recomputes from scratch, so it is correct either way as long as it
     * can never observe the event inserted but not yet folded).
     *
     * Returns only the events actually inserted (idempotency, as `append` alone did), and only
     * those are folded — a replayed job changes mastery once, not twice.
     */
    async appendAndFold(
      scope: StudentScope,
      events: EvidenceEventEntry[],
    ): Promise<EvidenceEvent[]> {
      const method = 'evidenceEvents.appendAndFold';
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

          await tx
            .insert(learnerProfiles)
            .values({
              studentId: sc.studentId,
              teacherId: sc.teacherId,
              lang: 'en',
              mastery: {},
              mistakes: [],
            })
            .onConflictDoNothing({
              target: [learnerProfiles.teacherId, learnerProfiles.studentId],
            });

          // Locked *before* the events are inserted — see the doc comment above.
          const [locked] = await tx
            .select({
              mastery: learnerProfiles.mastery,
              memoryResetAt: learnerProfiles.memoryResetAt,
            })
            .from(learnerProfiles)
            .where(
              and(
                eq(learnerProfiles.teacherId, sc.teacherId),
                eq(learnerProfiles.studentId, sc.studentId),
              ),
            )
            .for('update');
          /* v8 ignore next */
          if (!locked) throw new RepositoryError('scope', method);

          const survivors = dropBeforeReset(list, locked.memoryResetAt);
          if (survivors.length < list.length) {
            debug(
              '%s: reset watermark dropped %d of %d event(s) for %s/%s',
              method,
              list.length - survivors.length,
              list.length,
              sc.teacherId,
              sc.studentId,
            );
          }
          if (survivors.length === 0) return [];

          const rows = await tx
            .insert(evidenceEvents)
            .values(
              survivors.map((e) => ({
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
          const applied = rows.map((r) => toEvidenceEvent(r, method));

          if (applied.length > 0) {
            const next = foldMastery(
              locked.mastery,
              applied.map((e) => ({ topicId: e.topicId, correct: e.correct, ts: e.ts })),
            );
            await tx
              .update(learnerProfiles)
              .set({ mastery: next, updatedAt: sql`now()` })
              .where(
                and(
                  eq(learnerProfiles.teacherId, sc.teacherId),
                  eq(learnerProfiles.studentId, sc.studentId),
                ),
              );
          }

          return applied;
        }),
      );
    },

    /**
     * Task 6.5: the scope's own evidence, for export, ordered `ts ASC, id ASC` (same tie-break as
     * `rebuildMastery`'s replay). `limit` is capped at `EVIDENCE_LIST_MAX`; a bigger one is
     * `invalid`. Fetches `limit + 1` rows to set `truncated`, so a cut export always says so
     * rather than silently looking complete.
     */
    async list(
      scope: StudentScope,
      options: { limit: number },
    ): Promise<{ events: EvidenceEvent[]; truncated: boolean }> {
      const method = 'evidenceEvents.list';
      const sc = studentScope(scope, method);
      const { limit } = parseArg(ListOptions, options, method);
      const rows = await db
        .select({
          studentId: evidenceEvents.studentId,
          teacherId: evidenceEvents.teacherId,
          topicId: evidenceEvents.topicId,
          correct: evidenceEvents.correct,
          source: evidenceEvents.source,
          weight: evidenceEvents.weight,
          ts: evidenceEvents.ts,
        })
        .from(evidenceEvents)
        .where(
          and(
            eq(evidenceEvents.teacherId, sc.teacherId),
            eq(evidenceEvents.studentId, sc.studentId),
          ),
        )
        .orderBy(asc(evidenceEvents.ts), asc(evidenceEvents.id))
        .limit(limit + 1);
      const truncated = rows.length > limit;
      return { events: rows.slice(0, limit).map((r) => toEvidenceEvent(r, method)), truncated };
    },
  };
}

const ListOptions = z.strictObject({ limit: z.int().min(1).max(EVIDENCE_LIST_MAX) });
