import { randomUUID } from 'node:crypto';
import { LIMITS } from '@edmate/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import {
  agents,
  agentVersions,
  learnerProfiles,
  packages,
  packageVersions,
  sessions,
} from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { iso } from './map.js';
import { IdSchema, parseArg, studentScope, type StudentScope } from './scope.js';

/** A study session as stored. No contract type exists for it; help_state's shape belongs to 3.5. */
export interface SessionRow {
  id: string;
  studentId: string;
  teacherId: string;
  agentId: string;
  agentVersion: number;
  /**
   * The package version the session's entitlement resolved to when it was created (task 3.16).
   * Null only on a session that had already ended before migration 0009.
   */
  packageId: string | null;
  packageVersion: number | null;
  helpState: unknown;
  summary: string | null;
  endedAt: string | null;
  createdAt: string;
}

/**
 * The WHERE clause that puts a session in scope. Messages and turn traces carry no teacher_id or
 * student_id: they are scoped through their session in the same statement (a join for reads,
 * `INSERT … SELECT … FROM sessions WHERE <this>` for writes).
 */
export const ownSession = (sessionId: string, scope: StudentScope) =>
  and(
    eq(sessions.id, sessionId),
    eq(sessions.studentId, scope.studentId),
    eq(sessions.teacherId, scope.teacherId),
  );

/**
 * The stored help state as JSON text, or `invalid`: not serialisable (circular, BigInt, a bare
 * `undefined`) or over `LIMITS.helpStateMaxJsonLength` UTF-16 units (ADR-0005). Checked before
 * any SQL, so an oversized value is never written.
 */
function helpStateJson(value: unknown, method: string): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new RepositoryError('invalid', method);
  }
  if (json === undefined || json.length > LIMITS.helpStateMaxJsonLength) {
    throw new RepositoryError('invalid', method);
  }
  return json;
}

const NewSession = z.strictObject({
  agentId: IdSchema,
  agentVersion: z.int().min(0),
  packageId: IdSchema,
  packageVersion: z.int().min(0),
});

export function sessionsRepo(db: Db) {
  return {
    /**
     * Starts a session for the scope's student with one of the scope's teacher's agent versions,
     * pinned to the package version the caller's entitlement resolved to just before (task 3.16).
     * Another teacher's agent or package, a package of another agent, or a version that doesn't
     * exist, is `not_found`.
     */
    async create(
      scope: StudentScope,
      input: { agentId: string; agentVersion: number; packageId: string; packageVersion: number },
    ): Promise<{ id: string }> {
      const method = 'sessions.create';
      const { studentId, teacherId } = studentScope(scope, method);
      const { agentId, agentVersion, packageId, packageVersion } = parseArg(
        NewSession,
        input,
        method,
      );
      const id = randomUUID();
      const result = await translateWrite(method, () =>
        db.execute(
          insertSelect(
            sessions,
            [
              [sessions.id, sql`${id}::text`],
              [sessions.studentId, sql`${studentId}::text`],
              [sessions.teacherId, sql`${agents.teacherId}`],
              [sessions.agentId, sql`${agents.id}`],
              [sessions.agentVersion, sql`${agentVersions.version}`],
              [sessions.packageId, sql`${packageVersions.packageId}`],
              [sessions.packageVersion, sql`${packageVersions.version}`],
            ],
            sql`from ${agentVersions} join ${agents} on ${agents.id} = ${agentVersions.agentId}
                join ${packages} on ${packages.agentId} = ${agents.id}
                join ${packageVersions} on ${packageVersions.packageId} = ${packages.id}
                where ${and(
                  eq(agents.id, agentId),
                  eq(agents.teacherId, teacherId),
                  eq(agentVersions.teacherId, teacherId),
                  eq(agentVersions.version, agentVersion),
                  eq(packages.id, packageId),
                  eq(packages.teacherId, teacherId),
                  eq(packageVersions.teacherId, teacherId),
                  eq(packageVersions.version, packageVersion),
                )}`,
          ),
        ),
      );
      if (written(result) !== 1) throw new RepositoryError('not_found', method);
      return { id };
    },

    /**
     * Saves the help state of the scope's own **open** session (ADR-0005; last write wins). A
     * missing, ended, or another student's or teacher's session is `not_found`; a value that is
     * not serialisable or is over `LIMITS.helpStateMaxJsonLength` is `invalid` and nothing is
     * written. The value holds the answer key: this column is the only place it is stored.
     */
    async saveHelpState(scope: StudentScope, sessionId: string, helpState: unknown): Promise<void> {
      const method = 'sessions.saveHelpState';
      const sc = studentScope(scope, method);
      const id = parseArg(IdSchema, sessionId, method);
      const json = helpStateJson(helpState, method);
      const result = await db
        .update(sessions)
        .set({ helpState: sql`${json}::jsonb` })
        .where(and(ownSession(id, sc), isNull(sessions.endedAt)));
      if (written(result) !== 1) throw new RepositoryError('not_found', method);
    },

    /**
     * Task 3.16: the scope's entitlement no longer names the package version this session is
     * pinned to. In one transaction, ends the session if it is still open and, only when this
     * call is the one that ended it, clears the pair's `learner_profiles.last_summary` (no error
     * if there is no profile row). So a retried or stale turn on an already-ended session is a
     * no-op that can never wipe a summary written since under a new session; `ended` says which.
     *
     * The scope must come from the entitlement, never from the client. A session that is missing
     * or another student's or teacher's is `not_found` and nothing is written.
     *
     * help_state is kept on purpose: an ended session can't be loaded for a turn (TurnConfigStore
     * fails closed on it), and deleting session data is the retention job's work.
     */
    async endOnPackageChange(scope: StudentScope, sessionId: string): Promise<{ ended: boolean }> {
      const method = 'sessions.endOnPackageChange';
      const sc = studentScope(scope, method);
      const id = parseArg(IdSchema, sessionId, method);
      return db.transaction(async (tx) => {
        const closed = await tx
          .update(sessions)
          .set({ endedAt: sql`now()` })
          .where(and(ownSession(id, sc), isNull(sessions.endedAt)));
        if (written(closed) === 1) {
          await tx
            .update(learnerProfiles)
            .set({ lastSummary: null })
            .where(
              and(
                eq(learnerProfiles.teacherId, sc.teacherId),
                eq(learnerProfiles.studentId, sc.studentId),
              ),
            );
          return { ended: true };
        }
        const [own] = await tx
          .select({ id: sessions.id })
          .from(sessions)
          .where(ownSession(id, sc))
          .limit(1);
        if (!own) throw new RepositoryError('not_found', method);
        return { ended: false };
      });
    },

    /** The scope's session, or null if it is missing or another student's or teacher's. */
    async get(scope: StudentScope, sessionId: string): Promise<SessionRow | null> {
      const method = 'sessions.get';
      const { studentId, teacherId } = studentScope(scope, method);
      const id = parseArg(IdSchema, sessionId, method);
      const [row] = await db
        .select({
          id: sessions.id,
          studentId: sessions.studentId,
          teacherId: sessions.teacherId,
          agentId: sessions.agentId,
          agentVersion: sessions.agentVersion,
          packageId: sessions.packageId,
          packageVersion: sessions.packageVersion,
          helpState: sessions.helpState,
          summary: sessions.summary,
          endedAt: sessions.endedAt,
          createdAt: sessions.createdAt,
        })
        .from(sessions)
        .where(ownSession(id, { studentId, teacherId }))
        .limit(1);
      if (!row) return null;
      return {
        ...row,
        endedAt: row.endedAt === null ? null : iso(row.endedAt),
        createdAt: iso(row.createdAt),
      };
    },
  };
}
