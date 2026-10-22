// Takedowns (task 12.2b): staff take down one teacher document or a whole agent, and lift it
// again. No migration: the `takedowns` table and `takedowns_target_idx` are from 0001.
//
// - `target` is `document:<id>` or `agent:<id>`; `reason` is one REPORT_CATEGORIES category;
//   `status` is `active` or `lifted`. At most one active takedown per target, serialised by the
//   target row's lock (there is no unique index, so no migration).
// - A document takedown is a filter, not a delete (12.2 Q4): `notTakenDown` below is the only
//   place that writes the predicate. retrieval.ts adds it to `rank()`'s one scope fragment (text,
//   vector and term stats) and to `material()` (leakCheck's locked index); chunks.ts adds it to
//   `listForModule` (the outline drafter). The chunks stay, so a lift brings them back, and a
//   replace of the same document id can't. Create and lift bump the teacher's material revision,
//   so leakCheck's cache is rebuilt.
// - An agent takedown sets the agent `suspended`; every student-facing read already requires
//   `live`, and publish refuses a suspended agent. A lift sets it `live` again when it has a live
//   version, else `draft`.
// - Staff checks use `lockRole` (role-lock.ts): this file never names the user table.
//
// Lock order (8.7a lesson). `create` and `lift` take, in this order: the staff user's role row
// (`FOR SHARE`), the target row (`FOR UPDATE`: the document, or the agent), the takedown row,
// then the linked report (`FOR UPDATE`, create only). That is reports.review's "role first,
// report last". publish (startRun, goLive) takes advisory, profile, agent, run and never a user
// role row, a document, a takedown or a report, so the only row both take is the agent, and
// neither holds anything the other wants while waiting on it: no cycle. The two-connection test
// in test/takedowns.int.test.ts forces both queue orders against publish.goLive.
import { and, desc, eq, getTableName, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Db } from '../client.js';
import { lockRole } from '../role-lock.js';
import {
  agents,
  documents,
  messages,
  reports,
  sessions,
  takedowns,
  teacherProfiles,
} from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { bumpRevision } from './chunks.js';
import { RepositoryError, translateWrite } from './errors.js';
import {
  iso,
  ReportCategorySchema,
  type StaffTakedownRow,
  TAKEDOWN_KINDS,
  type TakedownKind,
  TakedownKindSchema,
  toStaffTakedownRow,
} from './map.js';
import { IdSchema, parseArg } from './scope.js';

export { TAKEDOWN_KINDS, type StaffTakedownRow, type TakedownKind };

/** The staff list shows at most this many active takedowns, newest first. */
export const TAKEDOWNS_ACTIVE_MAX_LIMIT = 200;
/** A staff note's maximum length (the audit reason's cap). */
export const TAKEDOWN_NOTE_MAX = 500;

const Note = z.string().trim().min(1).max(TAKEDOWN_NOTE_MAX);

const CreateInput = z.strictObject({
  kind: TakedownKindSchema,
  targetId: IdSchema,
  category: ReportCategorySchema,
  reportId: IdSchema.optional(),
  note: Note.optional(),
});
export type TakedownCreateInput = z.infer<typeof CreateInput>;

const LiftInput = z.strictObject({ note: Note.optional() });
export type TakedownLiftInput = z.infer<typeof LiftInput>;

const qualified = (c: PgColumn): SQL =>
  sql`${sql.identifier(getTableName(c.table))}.${sql.identifier(c.name)}`;

/**
 * The one takedown predicate: true when the document whose id is in `documentId` has no active
 * takedown. Every column is qualified by hand, so the outer column can never bind to a takedowns
 * column inside the subquery. It probes `takedowns_target_idx` (target equality).
 */
export function notTakenDown(documentId: PgColumn): SQL {
  return sql`not exists (select 1 from ${sql.identifier(getTableName(takedowns))} where ${qualified(
    takedowns.target,
  )} = 'document:' || ${qualified(documentId)} and ${qualified(takedowns.status)} = 'active')`;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const targetOf = (kind: TakedownKind, id: string) => `${kind}:${id}`;

/** Staff only: `scope` for anyone who is not staff right now (the id is already parsed). */
async function requireStaff(tx: Pick<Db, 'select'>, by: string, method: string): Promise<void> {
  if ((await lockRole(tx, by)) !== 'staff') throw new RepositoryError('scope', method);
}

interface LockedTarget {
  teacherId: string;
  agent?: { status: 'draft' | 'live' | 'suspended'; liveVersion: number | null };
}

/** The target row, locked FOR UPDATE; null when it does not exist. */
async function lockTarget(
  tx: Tx,
  kind: TakedownKind,
  targetId: string,
): Promise<LockedTarget | null> {
  if (kind === 'document') {
    const [d] = await tx
      .select({ teacherId: documents.teacherId })
      .from(documents)
      .where(eq(documents.id, targetId))
      .for('update');
    return d ?? null;
  }
  const [a] = await tx
    .select({ teacherId: agents.teacherId, status: agents.status, liveVersion: agents.liveVersion })
    .from(agents)
    .where(eq(agents.id, targetId))
    .for('update');
  return a
    ? { teacherId: a.teacherId, agent: { status: a.status, liveVersion: a.liveVersion } }
    : null;
}

/** Appends one `{ actor, action, note, ts }` entry to a trust row's `staff_actions`. */
const staffAction = (
  column: typeof takedowns.staffActions | typeof reports.staffActions,
  actor: string,
  action: string,
  note: string | null,
  extra: SQL = sql``,
) =>
  sql`${column} || jsonb_build_array(jsonb_build_object('actor', ${actor}::text, 'action', ${action}::text, 'note', ${note}::text, 'ts', now()${extra}))`;

/** Parses a stored `<kind>:<id>` target; anything else is null. */
function parseTarget(target: string): { kind: TakedownKind; id: string } | null {
  const at = target.indexOf(':');
  const kind = TakedownKindSchema.safeParse(target.slice(0, at));
  const id = IdSchema.safeParse(target.slice(at + 1));
  return at > 0 && kind.success && id.success ? { kind: kind.data, id: id.data } : null;
}

export function takedownsRepo(db: Db) {
  return {
    /**
     * Staff take down a document or an agent, in one transaction (lock order in the file header):
     * `by` must be staff now (`scope`); a missing target is `not_found`; a target that already
     * has an active takedown is `invalid`. The row is written `active` with its first staff
     * action; an agent is set `suspended`; a document bumps the teacher's material revision. A
     * `reportId` must be an open report about the same teacher (else `invalid`, nothing written);
     * it is set `actioned` (staff action and `report.review` audit row). Audited
     * `takedown.create`.
     */
    async create(by: unknown, input: TakedownCreateInput): Promise<{ id: string }> {
      const method = 'takedowns.create';
      const staff = parseArg(IdSchema, by, method);
      const c = parseArg(CreateInput, input, method);
      const target = targetOf(c.kind, c.targetId);
      const note = c.note ?? null;
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          await requireStaff(tx, staff, method);
          const locked = await lockTarget(tx, c.kind, c.targetId);
          if (!locked) throw new RepositoryError('not_found', method);
          const [active] = await tx
            .select({ id: takedowns.id })
            .from(takedowns)
            .where(and(eq(takedowns.target, target), eq(takedowns.status, 'active')));
          if (active) throw new RepositoryError('invalid', method);

          const [row] = await tx
            .insert(takedowns)
            .values({
              target,
              reason: c.category,
              status: 'active',
              staffActions: sql`jsonb_build_array(jsonb_build_object('actor', ${staff}::text, 'action', 'create', 'note', ${note}::text, 'ts', now()))`,
            })
            .returning({ id: takedowns.id });
          /* v8 ignore next -- an insert without a conflict clause returns its row */
          if (!row) throw new RepositoryError('integrity', method);

          if (c.reportId !== undefined) {
            const [report] = await tx
              .select({ teacherId: sessions.teacherId })
              .from(reports)
              .innerJoin(
                messages,
                sql`${messages.id} = substr(${reports.target}, ${'message:'.length + 1})`,
              )
              .innerJoin(sessions, eq(sessions.id, messages.sessionId))
              .where(
                and(
                  eq(reports.id, c.reportId),
                  eq(reports.status, 'open'),
                  sql`${reports.target} like 'message:%'`,
                ),
              )
              .for('update', { of: reports });
            if (report?.teacherId !== locked.teacherId) {
              throw new RepositoryError('invalid', method);
            }
            await tx
              .update(reports)
              .set({
                status: 'actioned',
                staffActions: staffAction(
                  reports.staffActions,
                  staff,
                  'actioned',
                  note,
                  sql`, 'takedown', ${row.id}::text`,
                ),
              })
              .where(eq(reports.id, c.reportId));
            await insertAuditEntry(tx, method, locked.teacherId, null, {
              actor: staff,
              actorRole: 'staff',
              action: 'report.review',
              target: `report:${c.reportId}`,
              ...(c.note === undefined ? {} : { reason: c.note }),
              before: { status: 'open' },
              after: { status: 'actioned', takedown: row.id },
            });
          }

          if (locked.agent) {
            await tx.update(agents).set({ status: 'suspended' }).where(eq(agents.id, c.targetId));
          } else {
            await bumpRevision(tx, locked.teacherId);
          }
          await insertAuditEntry(tx, method, locked.teacherId, null, {
            actor: staff,
            actorRole: 'staff',
            action: 'takedown.create',
            target,
            ...(c.note === undefined ? {} : { reason: c.note }),
            before: locked.agent
              ? { status: locked.agent.status, takedown: null }
              : { takedown: null },
            after: {
              takedown: row.id,
              status: 'active',
              category: c.category,
              reportId: c.reportId ?? null,
              ...(locked.agent ? { agentStatus: 'suspended' } : {}),
            },
          });
          return { id: row.id };
        }),
      );
    },

    /**
     * Staff lift an active takedown, in one transaction (same lock order): `by` must be staff
     * now (`scope`); the takedown must exist and still be active once the target is locked
     * (else `not_found`, so a second or concurrent lift writes nothing). It is set `lifted`; an
     * agent goes back to `live` when it has a live version, else `draft`; a document bumps the
     * material revision. Audited `takedown.lift`. A stored target that is malformed or gone is
     * `integrity`.
     */
    async lift(
      by: unknown,
      takedownId: unknown,
      input: TakedownLiftInput,
    ): Promise<{ id: string; status: 'lifted' }> {
      const method = 'takedowns.lift';
      const staff = parseArg(IdSchema, by, method);
      const id = parseArg(IdSchema, takedownId, method);
      const l = parseArg(LiftInput, input, method);
      const note = l.note ?? null;
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          await requireStaff(tx, staff, method);
          // The target first (unlocked: a takedown's target is never updated), so the target row
          // is locked before the takedown row, as in create.
          const [ref] = await tx
            .select({ target: takedowns.target })
            .from(takedowns)
            .where(eq(takedowns.id, id));
          if (!ref) throw new RepositoryError('not_found', method);
          const t = parseTarget(ref.target);
          if (!t) throw new RepositoryError('integrity', method);
          const locked = await lockTarget(tx, t.kind, t.id);
          if (!locked) throw new RepositoryError('integrity', method);
          const [row] = await tx
            .select({ id: takedowns.id })
            .from(takedowns)
            .where(and(eq(takedowns.id, id), eq(takedowns.status, 'active')))
            .for('update');
          if (!row) throw new RepositoryError('not_found', method);

          await tx
            .update(takedowns)
            .set({
              status: 'lifted',
              staffActions: staffAction(takedowns.staffActions, staff, 'lift', note),
            })
            .where(eq(takedowns.id, id));
          const restored = locked.agent?.liveVersion == null ? 'draft' : 'live';
          if (locked.agent) {
            await tx.update(agents).set({ status: restored }).where(eq(agents.id, t.id));
          } else {
            await bumpRevision(tx, locked.teacherId);
          }
          await insertAuditEntry(tx, method, locked.teacherId, null, {
            actor: staff,
            actorRole: 'staff',
            action: 'takedown.lift',
            target: ref.target,
            ...(l.note === undefined ? {} : { reason: l.note }),
            before: { takedown: id, status: 'active' },
            after: {
              takedown: id,
              status: 'lifted',
              ...(locked.agent ? { agentStatus: restored } : {}),
            },
          });
          return { id, status: 'lifted' as const };
        }),
      );
    },

    /**
     * The active takedowns, newest first by (created_at, id), capped at
     * TAKEDOWNS_ACTIVE_MAX_LIMIT, for a user who is staff right now: kind, target id, the
     * target's teacher and slug, category and when.
     */
    async listActiveForStaff(by: unknown): Promise<StaffTakedownRow[]> {
      const method = 'takedowns.listActiveForStaff';
      const staff = parseArg(IdSchema, by, method);
      return db.transaction(async (tx) => {
        await requireStaff(tx, staff, method);
        const teacher = sql<string | null>`coalesce(${documents.teacherId}, ${agents.teacherId})`;
        const rows = await tx
          .select({
            id: takedowns.id,
            target: takedowns.target,
            reason: takedowns.reason,
            createdAt: takedowns.createdAt,
            teacherId: teacher,
            slug: teacherProfiles.slug,
          })
          .from(takedowns)
          .leftJoin(documents, sql`${takedowns.target} = 'document:' || ${documents.id}`)
          .leftJoin(agents, sql`${takedowns.target} = 'agent:' || ${agents.id}`)
          .leftJoin(teacherProfiles, eq(teacherProfiles.userId, teacher))
          .where(
            and(
              eq(takedowns.status, 'active'),
              or(
                sql`${takedowns.target} like 'document:%'`,
                sql`${takedowns.target} like 'agent:%'`,
              ),
            ),
          )
          .orderBy(desc(takedowns.createdAt), desc(takedowns.id))
          .limit(TAKEDOWNS_ACTIVE_MAX_LIMIT);
        return rows.map((r) => {
          const t = parseTarget(r.target);
          if (!t) throw new RepositoryError('integrity', method);
          return toStaffTakedownRow(
            {
              id: r.id,
              kind: t.kind,
              targetId: t.id,
              teacherId: r.teacherId,
              teacherSlug: r.slug,
              category: r.reason,
              createdAt: iso(r.createdAt),
            },
            method,
          );
        });
      });
    },
  };
}
