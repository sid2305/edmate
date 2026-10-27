import { randomUUID } from 'node:crypto';
import { countWords, LIMITS } from '@edmate/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
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

/**
 * Task 9.6a: a keyset page cursor for the export readers (`sessions.listForStudent`,
 * `messages.listForStudent`). `(createdAt, id)` is the tie-break order both readers use, so a
 * cursor from one page names exactly where the next page resumes, stable across a `created_at`
 * tie (ordered by `id` within the tie). A malformed cursor (bad id format or not an ISO instant)
 * is `invalid`.
 *
 * `z.iso.datetime()` (task 9.6a LOW, 9.6f follow-up): by default this accepts only a `Z`-suffixed
 * UTC instant (no `+hh:mm`/`-hh:mm` offset form) and no fractional-second truncation beyond what
 * zod itself allows; a cursor is always `createdAt.toISOString()`'s own `Z`-suffixed output
 * (`messages.ts`/`sessions.ts`'s `listForStudent`), so no caller needs the offset form and a
 * stricter cursor can't silently skip rows through a timezone-offset misparse.
 */
export const ExportCursorSchema = z.strictObject({ createdAt: z.iso.datetime(), id: IdSchema });
export type ExportCursor = z.infer<typeof ExportCursorSchema>;

/** Largest page `sessions.listForStudent`/`messages.listForStudent` return; a bigger `limit` is `invalid`. */
export const EXPORT_PAGE_MAX = 500;

export const ExportListOptions = z.strictObject({
  after: ExportCursorSchema.optional(),
  limit: z.int().min(1).max(EXPORT_PAGE_MAX),
});
export type ExportListOptions = z.infer<typeof ExportListOptions>;

/** One session of a complete export (task 9.6a): never `help_state` or `studentId`/`teacherId`. */
export interface SessionExportRow {
  id: string;
  agentId: string;
  agentVersion: number;
  packageId: string | null;
  packageVersion: number | null;
  summary: string | null;
  createdAt: string;
  endedAt: string | null;
}

export function sessionsRepo(db: Db) {
  return {
    /**
     * Starts a session for the scope's student with one of the scope's teacher's agent versions,
     * pinned to the package version the caller's entitlement resolved to just before (task 3.16).
     * Another teacher's agent or package, a package of another agent, or a version that doesn't
     * exist, is `not_found`.
     *
     * Task 5.10d: at most one open session per (teacher_id, student_id, agent_id) — reuse, not
     * end-and-recreate, so a page refresh or a second tab never silently wipes `help_state` (the
     * hint ladder, ADR-0005). Inside one transaction: the ownership-checked insert above, with
     * `ON CONFLICT (teacher_id, student_id, agent_id) WHERE ended_at IS NULL DO NOTHING` appended
     * (raw SQL, like `teacher-questions.ts`'s `open()` — drizzle's `onConflictDoNothing()` can't
     * infer a partial-index target, see that file's comment on `42P10`/`42601`). 0 rows written
     * from the insert is ambiguous between "lost the race" and "no such agent/package/version", and
     * the conflict target is **not** version-specific, so it isn't safe to resolve that by just
     * checking whether *some* open session already exists for the triple — a scope with a real
     * open session (any version) but a bad `agentVersion`/`packageVersion` in *this* call would
     * then wrongly "succeed" by reusing that unrelated session instead of `not_found`. Resolved
     * instead by re-running the same ownership `WHERE` as a plain `SELECT` (no insert, no
     * conflict): no row means the original FROM/WHERE matched nothing, `not_found` as before; a
     * row means this call's agent/package/version really do resolve, so 0 rows written can only
     * mean another call's insert won the race (now committed and visible, since Postgres's own
     * `ON CONFLICT` blocks a second concurrent inserter until the first's transaction commits) —
     * read that open row and return its id (reused). Same `201` status and body shape (`{ id }`)
     * whether created or reused — the caller (`startSession`) needs no change.
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
      const col = (c: { name: string }) => sql.identifier(c.name);
      const ownershipWhere = and(
        eq(agents.id, agentId),
        eq(agents.teacherId, teacherId),
        eq(agentVersions.teacherId, teacherId),
        eq(agentVersions.version, agentVersion),
        eq(packages.id, packageId),
        eq(packages.teacherId, teacherId),
        eq(packageVersions.teacherId, teacherId),
        eq(packageVersions.version, packageVersion),
      );
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const result = await tx.execute(sql`
            ${insertSelect(
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
                  where ${ownershipWhere}`,
            )}
            on conflict (${col(sessions.teacherId)}, ${col(sessions.studentId)}, ${col(sessions.agentId)})
            where ${col(sessions.endedAt)} is null
            do nothing
          `);
          if (written(result) === 1) return { id };
          const [owned] = await tx
            .select({ ok: sql`1` })
            .from(agentVersions)
            .innerJoin(agents, eq(agents.id, agentVersions.agentId))
            .innerJoin(packages, eq(packages.agentId, agents.id))
            .innerJoin(packageVersions, eq(packageVersions.packageId, packages.id))
            .where(ownershipWhere)
            .limit(1);
          if (!owned) throw new RepositoryError('not_found', method);
          const [existing] = await tx
            .select({ id: sessions.id })
            .from(sessions)
            .where(
              and(
                eq(sessions.teacherId, teacherId),
                eq(sessions.studentId, studentId),
                eq(sessions.agentId, agentId),
                isNull(sessions.endedAt),
              ),
            )
            .limit(1);
          /* v8 ignore next -- the insert's own ON CONFLICT only fired because a row matching
           * (teacherId, studentId, agentId) WHERE ended_at IS NULL already existed at that
           * statement; this only throws if a second, concurrent transaction ended that very row
           * in the gap before this SELECT (same tiny window as teacher-questions.ts's `open`). */
          if (!existing) throw new RepositoryError('not_found', method);
          return { id: existing.id };
        }),
      );
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

    /**
     * Task 6.4: ends the scope's own **open** session normally (the opposite direction of
     * `endOnPackageChange`, 3.16), storing `summary` (the output of
     * `packages/harness/src/memory/sessionSummary.ts`'s `summarizeSession`, or `undefined` when
     * the session had no messages or the generator failed) on `sessions.summary` and, only when
     * this call is the one that ends it, upserting it onto `learner_profiles.last_summary` for
     * the same (student, teacher) pair — same upsert shape `applyMastery`/`applyMistakes` use for
     * a first-ever profile row, so a student's very first session still seeds a readable
     * `lastSummary` for session two.
     *
     * `summary === undefined` is written as SQL `NULL` on `sessions.summary` and leaves
     * `learner_profiles.last_summary` **unset** (the upsert's `SET` list never names
     * `last_summary` when `summary` is undefined), so a failed-to-summarize session can never
     * clobber a summary written by a prior session — same never-clobber discipline `applyMastery`
     * already requires of `mastery`.
     *
     * Already-ended (another call, or a race with `endOnPackageChange`) is a no-op, `{ ended:
     * false }`, nothing written: a retried call can never clobber a summary written since by a
     * session that started after this one ended. A summary over
     * `LIMITS.lastSummaryMaxWords` words is `invalid`, checked before any SQL — defense in depth,
     * since `summarizeSession`'s own schema should already guarantee this. A missing session, or
     * another student's or teacher's, is `not_found` and nothing is written.
     */
    async end(
      scope: StudentScope,
      sessionId: string,
      summary: string | undefined,
    ): Promise<{ ended: boolean }> {
      const method = 'sessions.end';
      const sc = studentScope(scope, method);
      const id = parseArg(IdSchema, sessionId, method);
      if (summary !== undefined && countWords(summary) > LIMITS.lastSummaryMaxWords) {
        throw new RepositoryError('invalid', method);
      }
      return db.transaction(async (tx) => {
        const closed = await tx
          .update(sessions)
          .set({ endedAt: sql`now()`, summary: summary ?? null })
          .where(and(ownSession(id, sc), isNull(sessions.endedAt)));
        if (written(closed) === 1) {
          if (summary !== undefined) {
            await tx
              .insert(learnerProfiles)
              .values({
                studentId: sc.studentId,
                teacherId: sc.teacherId,
                lang: 'en',
                mastery: {},
                mistakes: [],
                lastSummary: summary,
              })
              .onConflictDoUpdate({
                target: [learnerProfiles.teacherId, learnerProfiles.studentId],
                set: { lastSummary: summary, updatedAt: sql`now()` },
              });
          }
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

    /**
     * Task 9.6a: every one of the scope's own sessions (open and ended), oldest first by
     * `(createdAt, id)`, for a complete export. Never `help_state` (the answer key) and never
     * `studentId`/`teacherId` — only `sessions.get` (one session, by id) carries those. `limit`
     * is capped at `EXPORT_PAGE_MAX`; 0 or over the cap, or a malformed `after`, is `invalid`.
     * `next` is the cursor of the last row returned, or `null` on the last page.
     */
    async listForStudent(
      scope: StudentScope,
      options: { after?: ExportCursor; limit: number },
    ): Promise<{ items: SessionExportRow[]; next: ExportCursor | null }> {
      const method = 'sessions.listForStudent';
      const sc = studentScope(scope, method);
      const { after, limit } = parseArg(ExportListOptions, options, method);
      // Row-value compare (task 9.6f review HIGH), not `or(gt(...), and(eq(...), gt(...)))`: the
      // OR form makes Postgres plan `Index Cond: teacher_id = … AND student_id = …` plus a
      // `Filter` over every earlier row for the OR, instead of folding `(created_at, id)` into the
      // index's own trailing columns. `(created_at, id) > (at, afterId)` seeks directly.
      const cursor = after
        ? sql`(${sessions.createdAt}, ${sessions.id}) > (${new Date(after.createdAt)}, ${after.id})`
        : undefined;
      const rows = await db
        .select({
          id: sessions.id,
          agentId: sessions.agentId,
          agentVersion: sessions.agentVersion,
          packageId: sessions.packageId,
          packageVersion: sessions.packageVersion,
          summary: sessions.summary,
          createdAt: sessions.createdAt,
          endedAt: sessions.endedAt,
        })
        .from(sessions)
        .where(
          and(eq(sessions.studentId, sc.studentId), eq(sessions.teacherId, sc.teacherId), cursor),
        )
        .orderBy(asc(sessions.createdAt), asc(sessions.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const next: ExportCursor | null =
        rows.length > limit && last ? { createdAt: iso(last.createdAt), id: last.id } : null;
      return {
        items: page.map((r) => ({
          ...r,
          endedAt: r.endedAt === null ? null : iso(r.endedAt),
          createdAt: iso(r.createdAt),
        })),
        next,
      };
    },
  };
}
