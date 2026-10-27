import { type StyleCard, StyleCardSchema } from '@edmate/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { lockRole } from '../role-lock.js';
import { styleCards } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { checked } from './map.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

/**
 * Caps on a saved card beyond the contract's 300-word limit (task 8.4a): a single huge "word" or an
 * unbounded tag list would otherwise pass, and both are rendered into every turn's prompt.
 */
export const STYLE_CARD_LIMITS = {
  textMaxChars: 4000,
  tagsMax: 20,
  tagMaxChars: 60,
} as const;

/**
 * What a teacher saves: the card text and its mistake tags. A strict object, so a client-set
 * `id`, `teacherId` or `version` is `invalid` (the repository assigns all three). Tags are trimmed
 * and de-duplicated, keeping the teacher's order.
 */
const DraftInput = z.strictObject({
  text: z.string().max(STYLE_CARD_LIMITS.textMaxChars).regex(/\S/).pipe(StyleCardSchema.shape.text),
  mistakeTags: z
    .array(z.string().trim().min(1).max(STYLE_CARD_LIMITS.tagMaxChars))
    .max(STYLE_CARD_LIMITS.tagsMax)
    .transform((tags) => [...new Set(tags)]),
});

export type StyleCardDraftInput = z.input<typeof DraftInput>;

/**
 * Namespace for the per-teacher transaction lock (two-key advisory form, so it can never meet
 * migrate.ts's single-key lock). Arbitrary and used nowhere else.
 */
const VERSION_LOCK_NAMESPACE = 8401;

const columns = {
  id: styleCards.id,
  teacherId: styleCards.teacherId,
  version: styleCards.version,
  text: styleCards.text,
  mistakeTags: styleCards.mistakeTags,
};

/** The transaction type `db.transaction`'s callback receives. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Inserts the scope's next style-card version (its highest + 1, starting at 1) inside the
 * caller's own transaction `tx`, and returns it. Extracted from `create` (task 6.3a) so
 * `mistakeProposalsRepo.approve` can insert a new version atomically with marking its proposal
 * `approved`, without nesting `db.transaction` calls. `teacherId` must already be checked by the
 * caller (this function trusts it); the advisory lock serialises concurrent callers for the same
 * teacher, same as `create` always has.
 */
export async function insertNextVersion(
  tx: Tx,
  teacherId: string,
  draft: { text: string; mistakeTags: string[] },
  method: string,
): Promise<StyleCard> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${VERSION_LOCK_NAMESPACE}::int4, hashtext(${teacherId}))`,
  );
  const [current] = await tx
    .select({ max: sql<number>`coalesce(max(${styleCards.version}), 0)::int` })
    .from(styleCards)
    .where(eq(styleCards.teacherId, teacherId));
  const [row] = await tx
    .insert(styleCards)
    .values({
      teacherId,
      version: current!.max + 1,
      text: draft.text,
      mistakeTags: draft.mistakeTags,
    })
    .returning(columns);
  return checked(StyleCardSchema, row, method);
}

export function styleCardsRepo(db: Db) {
  return {
    /**
     * One immutable style card row of the scope's teacher; null if missing or another teacher's.
     * Each version is its own row with its own id, so `AgentConfig.styleCardId` names one version.
     */
    async get(scope: TeacherScope, id: string): Promise<StyleCard | null> {
      const method = 'styleCards.get';
      const { teacherId } = teacherScope(scope, method);
      const cardId = parseArg(IdSchema, id, method);
      const [row] = await db
        .select(columns)
        .from(styleCards)
        .where(and(eq(styleCards.id, cardId), eq(styleCards.teacherId, teacherId)))
        .limit(1);
      return row ? checked(StyleCardSchema, row, method) : null;
    },

    /** The scope's teacher's newest card version (the studio editor's starting point), or null. */
    async latest(scope: TeacherScope): Promise<StyleCard | null> {
      const method = 'styleCards.latest';
      const { teacherId } = teacherScope(scope, method);
      const [row] = await db
        .select(columns)
        .from(styleCards)
        .where(eq(styleCards.teacherId, teacherId))
        .orderBy(desc(styleCards.version))
        .limit(1);
      return row ? checked(StyleCardSchema, row, method) : null;
    },

    /**
     * Stores the scope's teacher's next card version (their highest + 1, starting at 1) as a new
     * immutable row and returns it. Nothing existing is changed: an agent version keeps the card
     * it names until a new agent version names this one. The scope must be a teacher user right
     * now (a ghost id is `not_found`, a student or staff id is `scope`). Concurrent saves by one
     * teacher are serialised by a transaction-scoped advisory lock on that teacher, so they get
     * consecutive versions; the unique (teacher_id, version) index stays the backstop (`invalid`).
     */
    async create(scope: TeacherScope, draft: StyleCardDraftInput): Promise<StyleCard> {
      const method = 'styleCards.create';
      const { teacherId } = teacherScope(scope, method);
      const d = parseArg(DraftInput, draft, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          // Share-locked so a concurrent role change can't slip between the check and the insert.
          const role = await lockRole(tx, teacherId);
          if (role === null) throw new RepositoryError('not_found', method);
          if (role !== 'teacher') throw new RepositoryError('scope', method);
          return insertNextVersion(tx, teacherId, d, method);
        }),
      );
    },
  };
}
