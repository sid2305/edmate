// Regulated subjects (task 12.4a): staff flag an agent as covering a regulated subject
// (investing, health or law) and approve it before it may publish (12.4b adds the publish block).
//
// - Staff only. Every method takes the acting user id `by` first; it must be a current `staff`
//   user (read through role-lock.ts, the role column alone), else `scope` and nothing is written.
// - Every change writes one audit row (`agent.regulated_flag` or `agent.regulated_approval`,
//   actorRole `staff`, target `agent:<id>`, the agent's teacher, before and after, the note as
//   its reason) in the same transaction as the change. A no-op writes nothing.
// - A subject change (or clearing it) clears the approval; the same subject keeps it. Approving
//   an unflagged agent is `invalid`.
// - The list carries ids, the teacher's public slug and the flag columns; never a name, email
//   or phone.
//
// Lock order (lessons: two writers that lock the same rows in different orders deadlock):
//   1. the acting user row, FOR SHARE (lockRole);
//   2. the agents row, FOR UPDATE.
// publish.ts (advisory lock, profile FOR SHARE, agent FOR UPDATE, run FOR UPDATE) never locks a
// user row, and 12.2b's takedowns are planned with the same user-then-agent order, so there is
// no cycle. The audit insert only takes KEY SHARE locks through its foreign keys.
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { lockRole } from '../role-lock.js';
import { agents, teacherProfiles } from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { RepositoryError } from './errors.js';
import { iso, type RegulatedAgentRow, toRegulatedAgentRow } from './map.js';
import { IdSchema, parseArg } from './scope.js';

/** The regulated subjects; test/regulated-subjects.test.ts keeps it equal to the contracts enum. */
export const REGULATED_SUBJECTS = ['investing', 'health', 'law'] as const;
export type RegulatedSubject = (typeof REGULATED_SUBJECTS)[number];
/** Most agents one staff list returns. */
export const REGULATED_LIST_MAX = 200;
/** Longest staff note, in characters (after trimming). */
export const REGULATED_NOTE_MAX = 500;
/** The audit actions the two writes record. */
export const REGULATED_FLAG_ACTION = 'agent.regulated_flag';
export const REGULATED_APPROVAL_ACTION = 'agent.regulated_approval';

const Note = z.string().trim().min(1).max(REGULATED_NOTE_MAX).optional();
const SubjectInput = z.strictObject({
  agentId: IdSchema,
  subject: z.enum(REGULATED_SUBJECTS).nullable(),
  note: Note,
});
const ApprovalInput = z.strictObject({
  agentId: IdSchema,
  approved: z.boolean(),
  note: Note,
});

export type RegulatedSubjectInput = z.input<typeof SubjectInput>;
export type RegulatedApprovalInput = z.input<typeof ApprovalInput>;

interface FlagState {
  regulatedSubject: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
}

const flagState = (r: {
  regulatedSubject: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
}): FlagState => ({
  regulatedSubject: r.regulatedSubject,
  approvedAt: r.approvedAt === null ? null : iso(r.approvedAt),
  approvedBy: r.approvedBy,
});

const flagColumns = {
  teacherId: agents.teacherId,
  regulatedSubject: agents.regulatedSubject,
  approvedAt: agents.regulatedApprovedAt,
  approvedBy: agents.regulatedApprovedBy,
};

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function regulatedSubjectsRepo(db: Db) {
  /** `by` must be a current staff user, else `scope`. `tx` is the caller's transaction or db. */
  async function requireStaff(tx: Pick<Db, 'select'>, by: string, method: string) {
    if ((await lockRole(tx, by)) !== 'staff') throw new RepositoryError('scope', method);
  }

  /** Steps 1 and 2 of the lock order: the staff role, then the agent row (`not_found`). */
  async function lockAgent(tx: Tx, by: string, agentId: string, method: string) {
    await requireStaff(tx, by, method);
    const [row] = await tx
      .select(flagColumns)
      .from(agents)
      .where(eq(agents.id, agentId))
      .for('update');
    if (row === undefined) throw new RepositoryError('not_found', method);
    return row;
  }

  /** Writes the new flag columns and the audit row; returns nothing (the caller says changed). */
  async function write(
    tx: Tx,
    method: string,
    a: { by: string; agentId: string; teacherId: string; action: string; note?: string | undefined },
    before: FlagState,
    set: { regulatedSubject: string | null; approve: boolean },
  ) {
    const [after] = await tx
      .update(agents)
      .set({
        regulatedSubject: set.regulatedSubject,
        regulatedApprovedAt: set.approve ? sql`now()` : null,
        regulatedApprovedBy: set.approve ? a.by : null,
        updatedAt: sql`now()`,
      })
      .where(eq(agents.id, a.agentId))
      .returning({
        regulatedSubject: agents.regulatedSubject,
        approvedAt: agents.regulatedApprovedAt,
        approvedBy: agents.regulatedApprovedBy,
      });
    await insertAuditEntry(tx, method, a.teacherId, null, {
      actor: a.by,
      actorRole: 'staff',
      action: a.action,
      target: `agent:${a.agentId}`,
      ...(a.note === undefined ? {} : { reason: a.note }),
      before,
      after: flagState(after!),
    });
  }

  return {
    /**
     * Every agent with its flag, newest first, at most `REGULATED_LIST_MAX`. `by` must be staff
     * right now (a plain read of the role: this writes nothing), else `scope`.
     */
    async listForStaff(by: string): Promise<RegulatedAgentRow[]> {
      const method = 'regulatedSubjects.listForStaff';
      const actor = parseArg(IdSchema, by, method);
      await requireStaff(db, actor, method);
      const rows = await db
        .select({
          agentId: agents.id,
          teacherSlug: teacherProfiles.slug,
          status: agents.status,
          liveVersion: agents.liveVersion,
          regulatedSubject: agents.regulatedSubject,
          approvedAt: agents.regulatedApprovedAt,
          approvedBy: agents.regulatedApprovedBy,
        })
        .from(agents)
        .leftJoin(teacherProfiles, eq(teacherProfiles.userId, agents.teacherId))
        .orderBy(desc(agents.createdAt), desc(agents.id))
        .limit(REGULATED_LIST_MAX);
      return rows.map((r) => toRegulatedAgentRow(r, method));
    },

    /**
     * Sets (or clears, with `null`) the agent's regulated subject, in one transaction in the lock
     * order above. The same subject is a no-op (`changed: false`, the approval kept, no audit
     * row); any change clears the approval and writes one `agent.regulated_flag` audit row.
     */
    async setSubject(by: string, input: RegulatedSubjectInput): Promise<{ changed: boolean }> {
      const method = 'regulatedSubjects.setSubject';
      const actor = parseArg(IdSchema, by, method);
      const { agentId, subject, note } = parseArg(SubjectInput, input, method);
      return db.transaction(async (tx) => {
        const current = await lockAgent(tx, actor, agentId, method);
        if (current.regulatedSubject === subject) return { changed: false };
        await write(
          tx,
          method,
          { by: actor, agentId, teacherId: current.teacherId, action: REGULATED_FLAG_ACTION, note },
          flagState(current),
          { regulatedSubject: subject, approve: false },
        );
        return { changed: true };
      });
    },

    /**
     * Approves (or revokes) the agent's flagged subject, in one transaction in the lock order
     * above. Approving an unflagged agent is `invalid`; the same state is a no-op (an existing
     * approval keeps its first approver); any change writes one `agent.regulated_approval` row.
     */
    async setApproval(by: string, input: RegulatedApprovalInput): Promise<{ changed: boolean }> {
      const method = 'regulatedSubjects.setApproval';
      const actor = parseArg(IdSchema, by, method);
      const { agentId, approved, note } = parseArg(ApprovalInput, input, method);
      return db.transaction(async (tx) => {
        const current = await lockAgent(tx, actor, agentId, method);
        if ((current.approvedAt !== null) === approved) return { changed: false };
        if (approved && current.regulatedSubject === null) {
          throw new RepositoryError('invalid', method);
        }
        await write(
          tx,
          method,
          { by: actor, agentId, teacherId: current.teacherId, action: REGULATED_APPROVAL_ACTION, note },
          flagState(current),
          { regulatedSubject: current.regulatedSubject, approve: approved },
        );
        return { changed: true };
      });
    },
  };
}
