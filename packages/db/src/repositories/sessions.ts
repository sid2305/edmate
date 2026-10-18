import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { agents, agentVersions, sessions } from '../schema/index.js';
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

const NewSession = z.strictObject({ agentId: IdSchema, agentVersion: z.int().min(0) });

export function sessionsRepo(db: Db) {
  return {
    /**
     * Starts a session for the scope's student with one of the scope's teacher's agent versions.
     * Another teacher's agent, or a version that doesn't exist, is `not_found`.
     */
    async create(
      scope: StudentScope,
      input: { agentId: string; agentVersion: number },
    ): Promise<{ id: string }> {
      const method = 'sessions.create';
      const { studentId, teacherId } = studentScope(scope, method);
      const { agentId, agentVersion } = parseArg(NewSession, input, method);
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
            ],
            sql`from ${agentVersions} join ${agents} on ${agents.id} = ${agentVersions.agentId}
                where ${and(
                  eq(agents.id, agentId),
                  eq(agents.teacherId, teacherId),
                  eq(agentVersions.teacherId, teacherId),
                  eq(agentVersions.version, agentVersion),
                )}`,
          ),
        ),
      );
      if (written(result) !== 1) throw new RepositoryError('not_found', method);
      return { id };
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
