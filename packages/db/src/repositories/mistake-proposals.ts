// Task 6.3a: mistake tags `classifyMistakeTags` saw but that are not yet on the style card's
// `mistakeTags` allow-list (ADR-0017), aggregated per teacher (not per student -- the allow-list
// itself is per-teacher, and `mistake_tag_proposals` has no `studentId` column) for the teacher to
// review and approve. `approve` shares `style-cards.ts`'s `insertNextVersion` so a new style-card
// version and the proposal's `approved` status commit or roll back together.
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { lockRole } from '../role-lock.js';
import { mistakeTagProposals, styleCards } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { checked } from './map.js';
import { insertNextVersion, STYLE_CARD_LIMITS } from './style-cards.js';
import { parseArg, teacherScope, type TeacherScope } from './scope.js';
import { type StyleCard, StyleCardSchema } from '@edmate/contracts';

/**
 * Namespace for `record`'s per-teacher advisory lock (task 6.3f fix 3). Distinct from
 * `style-cards.ts`'s `VERSION_LOCK_NAMESPACE` (8401): reusing that value would serialise
 * `record` against unrelated style-card writes for the same teacher for no reason -- the two
 * locks guard different tables and different invariants (the 100-row proposal cap here, a style
 * card's next version there).
 */
const MISTAKE_PROPOSAL_LOCK_NAMESPACE = 8402;

/** A single `record` call's patch is capped at this many tags; a bigger patch is `invalid`. */
export const MISTAKE_PROPOSAL_PATCH_MAX = 50;
/** A teacher's stored proposal rows (any status) are capped at this many; a `record` that would
 * add a new tag past the cap is `limit`, no partial write. */
export const MISTAKE_PROPOSALS_MAX = 100;
/** Largest page `listPending` returns. */
export const MISTAKE_PROPOSALS_LIST_MAX = 50;

const Tag = z.string().trim().min(1).max(STYLE_CARD_LIMITS.tagMaxChars);

// `@edmate/contracts`'s own `timestamp()` (`z.iso.datetime({ offset: true })`, `formats.ts`) is
// explicitly "not part of the public API" and not re-exported from the package's index -- task
// 6.3f's plan guessed it was importable, but `@edmate/contracts` is out of bounds for this task
// (rule 2: a contracts change needs an ADR). This mirrors the identical zod call locally instead
// of loosening the format or touching contracts.
const LastSeen = z.iso.datetime({ offset: true });

const ProposedInput = z.strictObject({
  tag: Tag,
  count: z.int().min(1),
  lastSeen: LastSeen,
});
const ProposedList = z.array(ProposedInput).max(MISTAKE_PROPOSAL_PATCH_MAX);

export type ProposedMistakeTagInput = z.input<typeof ProposedInput>;

export interface MistakeProposalRow {
  tag: string;
  count: number;
  lastSeen: string;
  status: 'pending' | 'approved' | 'rejected';
}

const columns = {
  tag: mistakeTagProposals.tag,
  count: mistakeTagProposals.count,
  lastSeen: mistakeTagProposals.lastSeen,
  status: mistakeTagProposals.status,
};

const Status = z.enum(['pending', 'approved', 'rejected']);

function toRow(row: {
  tag: string;
  count: number;
  lastSeen: Date;
  status: string;
}): MistakeProposalRow {
  const status = Status.parse(row.status);
  return { tag: row.tag, count: row.count, lastSeen: row.lastSeen.toISOString(), status };
}

export function mistakeProposalsRepo(db: Db) {
  return {
    /**
     * Upserts `proposed` by (teacher, tag): a new tag inserts a `pending` row; an existing
     * `pending` row merges (`count` summed, `lastSeen` the later of the two); an existing
     * `approved`/`rejected` row is left untouched (task 6.3a Q3: a dismissed or already-approved
     * tag never resurfaces on its own). `invalid` before any row is touched if `proposed` is
     * longer than `MISTAKE_PROPOSAL_PATCH_MAX`; `limit` (no partial write) if it would push the
     * teacher's stored row count past `MISTAKE_PROPOSALS_MAX`. An empty `proposed` is a no-op
     * (never checks the role, same as a true no-op elsewhere). `scope` if `teacherId` is not
     * currently a teacher (task 6.3f fix 2, same two-branch check `approve`/`reject` already use,
     * under the same per-teacher advisory lock that also guards the cap check, task 6.3f fix 3).
     */
    async record(scope: TeacherScope, proposed: ProposedMistakeTagInput[]): Promise<void> {
      const method = 'mistakeProposals.record';
      const { teacherId } = teacherScope(scope, method);
      const list = parseArg(ProposedList, proposed, method);
      if (list.length === 0) return;
      await translateWrite(method, () =>
        db.transaction(async (tx) => {
          const role = await lockRole(tx, teacherId);
          if (role === null) throw new RepositoryError('not_found', method);
          if (role !== 'teacher') throw new RepositoryError('scope', method);

          // A per-teacher advisory lock, taken before the count check below: `SELECT ... FOR
          // UPDATE` on `existing` only locks rows that already exist, so two concurrent `record`
          // calls for a teacher with no (or few, non-overlapping) stored rows can both read the
          // same stale count and both pass the cap check before either writes (task 6.3f fix 3).
          await tx.execute(
            sql`select pg_advisory_xact_lock(${MISTAKE_PROPOSAL_LOCK_NAMESPACE}::int4, hashtext(${teacherId}))`,
          );
          const existing = await tx
            .select({ tag: mistakeTagProposals.tag })
            .from(mistakeTagProposals)
            .where(eq(mistakeTagProposals.teacherId, teacherId))
            .for('update');
          const existingTags = new Set(existing.map((r) => r.tag));
          const newTags = new Set(list.map((p) => p.tag).filter((t) => !existingTags.has(t)));
          if (existing.length + newTags.size > MISTAKE_PROPOSALS_MAX) {
            throw new RepositoryError('limit', method);
          }
          for (const p of list) {
            await tx
              .insert(mistakeTagProposals)
              .values({
                teacherId,
                tag: p.tag,
                count: p.count,
                lastSeen: new Date(p.lastSeen),
                status: 'pending',
              })
              .onConflictDoUpdate({
                target: [mistakeTagProposals.teacherId, mistakeTagProposals.tag],
                set: {
                  count: sql`case when ${mistakeTagProposals.status} = 'pending'
                    then ${mistakeTagProposals.count} + ${p.count}
                    else ${mistakeTagProposals.count} end`,
                  lastSeen: sql`case when ${mistakeTagProposals.status} = 'pending'
                    then greatest(${mistakeTagProposals.lastSeen}, ${new Date(p.lastSeen)}::timestamptz)
                    else ${mistakeTagProposals.lastSeen} end`,
                  updatedAt: sql`now()`,
                },
              });
          }
        }),
      );
    },

    /** The scope's teacher's own pending rows, newest `lastSeen` first, capped at
     * `MISTAKE_PROPOSALS_LIST_MAX`. Approved/rejected rows never appear here. */
    async listPending(scope: TeacherScope): Promise<MistakeProposalRow[]> {
      const method = 'mistakeProposals.listPending';
      const { teacherId } = teacherScope(scope, method);
      const rows = await db
        .select(columns)
        .from(mistakeTagProposals)
        .where(
          and(
            eq(mistakeTagProposals.teacherId, teacherId),
            eq(mistakeTagProposals.status, 'pending'),
          ),
        )
        .orderBy(desc(mistakeTagProposals.lastSeen))
        .limit(MISTAKE_PROPOSALS_LIST_MAX);
      return rows.map(toRow);
    },

    /**
     * Approves the scope's teacher's pending proposal `tag`: locks the teacher's role and the
     * proposal row, re-checks `pending` (else `{approved: false, card: null}`, a race-safe no-op
     * for whichever concurrent `approve` call lost), reads the teacher's current latest style
     * card (`not_found` if none), and inserts a new style-card version whose `mistakeTags` is the
     * old version's tags plus `tag` (deduped), via `insertNextVersion`, in the same transaction as
     * marking the proposal `approved`.
     */
    async approve(
      scope: TeacherScope,
      tag: string,
    ): Promise<{ approved: boolean; card: StyleCard | null }> {
      const method = 'mistakeProposals.approve';
      const { teacherId } = teacherScope(scope, method);
      const t = parseArg(Tag, tag, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const role = await lockRole(tx, teacherId);
          if (role === null) throw new RepositoryError('not_found', method);
          if (role !== 'teacher') throw new RepositoryError('scope', method);

          const [proposal] = await tx
            .select({ status: mistakeTagProposals.status })
            .from(mistakeTagProposals)
            .where(
              and(eq(mistakeTagProposals.teacherId, teacherId), eq(mistakeTagProposals.tag, t)),
            )
            .for('update');
          if (proposal === undefined) throw new RepositoryError('not_found', method);
          if (proposal.status !== 'pending') return { approved: false, card: null };

          const [latest] = await tx
            .select({
              id: styleCards.id,
              teacherId: styleCards.teacherId,
              version: styleCards.version,
              text: styleCards.text,
              mistakeTags: styleCards.mistakeTags,
            })
            .from(styleCards)
            .where(eq(styleCards.teacherId, teacherId))
            .orderBy(desc(styleCards.version))
            .limit(1);
          if (latest === undefined) throw new RepositoryError('not_found', method);
          const current = checked(StyleCardSchema, latest, method);

          const merged = [...new Set([...current.mistakeTags, t])];
          // Fix 1 (task 6.3f): the merged tag list must still respect `tagsMax` -- otherwise
          // `insertNextVersion` (which trusts its caller, same as `create`'s own pre-checked
          // input) would write a style card with more tags than any client is ever allowed to
          // save. The proposal stays `pending` so the teacher can decide after trimming tags.
          if (merged.length > STYLE_CARD_LIMITS.tagsMax) throw new RepositoryError('limit', method);

          const card = await insertNextVersion(
            tx,
            teacherId,
            { text: current.text, mistakeTags: merged },
            method,
          );

          await tx
            .update(mistakeTagProposals)
            .set({ status: 'approved', decidedAt: sql`now()`, updatedAt: sql`now()` })
            .where(
              and(eq(mistakeTagProposals.teacherId, teacherId), eq(mistakeTagProposals.tag, t)),
            );

          return { approved: true, card };
        }),
      );
    },

    /**
     * Rejects the scope's teacher's pending proposal `tag`; never touches `style_cards`. Already
     * decided (or never existed as pending) is `{rejected: false}`, a no-op -- except a missing
     * row at all, which is `not_found` (same as `approve`, so the two can't be told apart by a
     * scope probe).
     */
    async reject(scope: TeacherScope, tag: string): Promise<{ rejected: boolean }> {
      const method = 'mistakeProposals.reject';
      const { teacherId } = teacherScope(scope, method);
      const t = parseArg(Tag, tag, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const role = await lockRole(tx, teacherId);
          if (role === null) throw new RepositoryError('not_found', method);
          if (role !== 'teacher') throw new RepositoryError('scope', method);

          const [proposal] = await tx
            .select({ status: mistakeTagProposals.status })
            .from(mistakeTagProposals)
            .where(
              and(eq(mistakeTagProposals.teacherId, teacherId), eq(mistakeTagProposals.tag, t)),
            )
            .for('update');
          if (proposal === undefined) throw new RepositoryError('not_found', method);
          if (proposal.status !== 'pending') return { rejected: false };

          await tx
            .update(mistakeTagProposals)
            .set({ status: 'rejected', decidedAt: sql`now()`, updatedAt: sql`now()` })
            .where(
              and(eq(mistakeTagProposals.teacherId, teacherId), eq(mistakeTagProposals.tag, t)),
            );

          return { rejected: true };
        }),
      );
    },
  };
}
