// Safety events (task 4.4, ADR-0006): moderationIn and jailbreak blocks, written by the
// safety-event worker. No migration: the table from 1.1 has `target` and `reason`.
//
// - `target` is `session:<sessionId>`: the session row gives the student and teacher, so writes
//   and reads are scoped through it in the same statement, like turn traces.
// - `reason` is `<guard>:<code>:<source>`, every part from a closed set. Never text.
// - The row id derives from ADR-0006's dedupe key (turn, guard): a replayed job writes nothing new.
// A jailbreak row is a strike; 12.x reads the count (no consequence yet, open question B-12).
import { createHash } from 'node:crypto';
import { SafetyEventCodeSchema } from '@edmate/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { safetyEvents, sessions } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { checked, iso } from './map.js';
import { IdSchema, parseArg, studentScope, type StudentScope } from './scope.js';
import { ownSession } from './sessions.js';

const GuardSchema = z.enum(['moderationIn', 'jailbreak']);
const SourceSchema = z.enum(['rule', 'classifier']);

/** What the worker records: SafetyEventSink's event without the scope (the scope is the call's). */
const EventSchema = z.strictObject({
  sessionId: IdSchema,
  turnId: IdSchema,
  guard: GuardSchema,
  code: SafetyEventCodeSchema,
  source: SourceSchema,
});
export type SafetyEventInput = z.infer<typeof EventSchema>;

/** A stored safety event, as read back for its student x teacher. */
export interface SafetyEventRow {
  id: string;
  studentId: string;
  teacherId: string;
  sessionId: string;
  guard: SafetyEventInput['guard'];
  code: SafetyEventInput['code'];
  source: SafetyEventInput['source'];
  status: string;
  createdAt: string;
}

const Reason = z.tuple([GuardSchema, SafetyEventCodeSchema, SourceSchema]);

/** The row id for (turn, guard): the same on every retry, any turn id fits the id format. */
export function safetyEventRowId(turnId: string, guard: SafetyEventInput['guard']): string {
  return `se_${createHash('sha256').update(`${turnId}\u0000${guard}`).digest('hex').slice(0, 40)}`;
}

/** `safety_events.target` joined to its session row. */
const onSession = eq(safetyEvents.target, sql`'session:' || ${sessions.id}`);

export function safetyEventsRepo(db: Db) {
  return {
    /**
     * Records one event on the scope's own session (another scope's, or a missing one, is
     * `not_found` and nothing is written). `written: false` when the (turn, guard) row was
     * already there: a replay.
     */
    async record(
      scope: StudentScope,
      event: SafetyEventInput,
    ): Promise<{ id: string; written: boolean }> {
      const method = 'safetyEvents.record';
      const sc = studentScope(scope, method);
      const e = parseArg(EventSchema, event, method);
      const id = safetyEventRowId(e.turnId, e.guard);
      const result = await translateWrite(method, () =>
        db.execute(
          sql`${insertSelect(
            safetyEvents,
            [
              [safetyEvents.id, sql`${id}::text`],
              [safetyEvents.target, sql`'session:' || ${sessions.id}`],
              [safetyEvents.reason, sql`${`${e.guard}:${e.code}:${e.source}`}::text`],
            ],
            sql`from ${sessions} where ${ownSession(e.sessionId, sc)}`,
          )} on conflict (id) do nothing`,
        ),
      );
      if (written(result) === 1) return { id, written: true };
      // Nothing written: a replay (the row is there, on this scope's session) or not the scope's.
      const [found] = await db
        .select({ id: safetyEvents.id })
        .from(safetyEvents)
        .innerJoin(sessions, onSession)
        .where(and(eq(safetyEvents.id, id), ownSession(e.sessionId, sc)));
      if (found === undefined) throw new RepositoryError('not_found', method);
      return { id, written: false };
    },

    /** The scope's session's events, oldest first; another scope's session reads as empty. */
    async listForSession(scope: StudentScope, sessionId: string): Promise<SafetyEventRow[]> {
      const method = 'safetyEvents.listForSession';
      const sc = studentScope(scope, method);
      const sid = parseArg(IdSchema, sessionId, method);
      const rows = await db
        .select({
          id: safetyEvents.id,
          reason: safetyEvents.reason,
          status: safetyEvents.status,
          createdAt: safetyEvents.createdAt,
          sessionId: sessions.id,
          studentId: sessions.studentId,
          teacherId: sessions.teacherId,
        })
        .from(safetyEvents)
        .innerJoin(sessions, onSession)
        .where(ownSession(sid, sc))
        .orderBy(asc(safetyEvents.createdAt), asc(safetyEvents.id));
      return rows.map((r) => {
        const [guard, code, source] = checked(Reason, r.reason.split(':'), method);
        return {
          id: r.id,
          studentId: r.studentId,
          teacherId: r.teacherId,
          sessionId: r.sessionId,
          guard,
          code,
          source,
          status: r.status,
          createdAt: iso(r.createdAt),
        };
      });
    },
  };
}
