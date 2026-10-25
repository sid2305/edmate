// Teacher profiles (task 8.1): a teacher creates, reads and edits their own profile; only a
// current staff user can verify or reject it; and an unverified teacher cannot publish. A teacher
// never sets their own verification: no teacher-facing input has a `verificationStatus` key, and
// the input objects are strict, so such a key is `invalid` before any SQL.
//
// Task 9.2d: `displayName` is the public name a teacher sets in onboarding (required at create,
// optional in a patch; omitting it in a patch leaves it unchanged). It never resets verification
// (unlike a subject change) and is validated server-side only (`DisplayName`, below) -- no URL,
// email or phone shape, no platform-impersonation word, collapsed to one line.
//
// `photo` has no input yet (the column stays null until a storage port exists, 8.2 or later) and
// `payoutAccountRef` belongs to payments (M10); neither is read or written here.
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { lockRole } from '../role-lock.js';
import { agents, takedowns, teacherProfiles, users } from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { RepositoryError, translateWrite } from './errors.js';
import { takeDownAgentInTx } from './takedowns.js';
import {
  toTeacherProfile,
  toTeacherVerificationQueueRow,
  type TeacherProfileRow,
  type TeacherVerificationQueueRow,
} from './map.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

/** Re-exported for index.ts (STAFF_QUEUE_MAX_LIMIT sits alongside it there). */
export type { TeacherVerificationQueueRow };

/**
 * The staff queue (task 12.1a) is capped like its siblings (`*_MAX_LIMIT`): a staff user sees at
 * most this many pending teachers in one read, oldest first.
 */
export const STAFF_QUEUE_MAX_LIMIT = 50;

/**
 * Lower-case words joined by single hyphens, 3 to 60 characters: it appears in public URLs.
 * Exported for discovery.ts (task 9.2: `teacherBySlug`'s input, read-only).
 */
export const Slug = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const Subject = z.string().trim().min(1).max(100);
const Bio = z.string().max(2000);
/**
 * One BCP 47-style tag such as `en` or `pt-BR`. Exported for discovery.ts (task 9.2: the
 * `language` search filter, read-only).
 */
export const LanguageTag = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
const Languages = z.array(LanguageTag).max(10);

// Task 9.2d: the public display name a teacher sets in onboarding. Only letters, marks, digits,
// space, `'`, `.` and `-` -- the same intent as the `NOT_ONE_LINE` set in
// `packages/contracts/src/payments.ts` (control, format, separator, surrogate, private-use and
// Hangul-filler characters), copied as a comment here, not imported (that constant is not
// exported and `packages/db` does not import from `packages/contracts` for this).
const DISPLAY_NAME_SHAPE = /^[\p{L}\p{M}\p{N} '.-]+$/u;
const DISPLAY_NAME_HAS_LETTER = /\p{L}/u;
/** `://`, `www.` (case-insensitive) or a `word.tld` run with no space (no URL shape). */
const DISPLAY_NAME_URL_SHAPE = /:\/\/|www\./i;
const DISPLAY_NAME_WORD_TLD = /[\p{L}\p{N}-]\.[a-z]{2,}/iu;
/**
 * Seven or more digits, optionally separated by space, `(`, `)`, `.` or `-` (no phone number).
 * `\p{N}` (not `\d`) so non-ASCII digit scripts (Devanagari, Arabic-Indic, ...) can't bypass this
 * -- NFKC (applied before this test) already folds fullwidth digits to ASCII, but not every
 * digit script folds under NFKC.
 */
const DISPLAY_NAME_PHONE_LIKE = /(?:\p{N}[\s().-]*){7,}/u;
/** No impersonation of the platform or staff (whole word, case-insensitive). */
const DISPLAY_NAME_IMPERSONATION = /\b(edmate|staff|admin|official)\b/i;

/**
 * The public name a teacher sets in onboarding, shown on discovery and the teacher page instead
 * of the sign-in name (task 9.2d). Trimmed, internal whitespace runs collapsed to one space,
 * then 2-60 characters with at least one letter; no web address, email, phone number or
 * platform-impersonation word. Exported for the unit test.
 */
export const DisplayName = z
  .string()
  // NFKC first: folds fullwidth/compatibility letters and digits (e.g. "ＡＤＭＩＮ" -> "ADMIN") to
  // their canonical form before the shape, phone and impersonation checks below -- otherwise a
  // fullwidth spelling of a blocked word passes every refine on the raw string. The stored value
  // is this normalized one.
  .transform((s) => s.normalize('NFKC').trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2)
      .max(60)
      .refine((s) => DISPLAY_NAME_HAS_LETTER.test(s), 'needs at least one letter')
      .refine(
        (s) => DISPLAY_NAME_SHAPE.test(s),
        "letters, numbers, spaces, ' . - only",
      )
      .refine(
        (s) => !DISPLAY_NAME_URL_SHAPE.test(s) && !DISPLAY_NAME_WORD_TLD.test(s),
        'no web address',
      )
      .refine((s) => !DISPLAY_NAME_PHONE_LIKE.test(s), 'no phone number')
      .refine((s) => !DISPLAY_NAME_IMPERSONATION.test(s), 'no platform name'),
  );

const CreateInput = z.strictObject({
  slug: Slug,
  displayName: DisplayName,
  subject: Subject,
  bio: Bio.optional(),
  languages: Languages.optional(),
});

/** What a teacher may edit. No verificationStatus, payoutAccountRef, photo or slug key. */
const UpdateInput = z
  .strictObject({
    displayName: DisplayName.optional(),
    subject: Subject.optional(),
    bio: Bio.optional(),
    languages: Languages.optional(),
  })
  .refine((p) => Object.keys(p).length > 0);

/**
 * Staff decide `verified` or `rejected`; `pending` is only the starting state. Task 9.3e:
 * `safety: true` marks a rejection made for a safety reason (it also takes the teacher's live
 * agents down); it only goes with `rejected`, so `safety: true` on an approval is `invalid`.
 */
const VerificationInput = z
  .strictObject({
    status: z.enum(['verified', 'rejected']),
    by: IdSchema,
    reason: z.string().min(1).max(500).optional(),
    safety: z.boolean().optional(),
  })
  .refine((v) => v.safety !== true || v.status === 'rejected');

export type TeacherProfileCreate = z.infer<typeof CreateInput>;
export type TeacherProfileUpdate = z.infer<typeof UpdateInput>;
export type TeacherVerificationInput = z.infer<typeof VerificationInput>;

const columns = {
  id: teacherProfiles.id,
  userId: teacherProfiles.userId,
  slug: teacherProfiles.slug,
  displayName: teacherProfiles.displayName,
  subject: teacherProfiles.subject,
  bio: teacherProfiles.bio,
  languages: teacherProfiles.languages,
  verificationStatus: teacherProfiles.verificationStatus,
};

export function teacherProfilesRepo(db: Db) {
  return {
    /**
     * The scope's own profile, starting `pending`. The scope must be a teacher user (a ghost id is
     * `not_found`, a student or staff id is `scope`); a second profile or a taken slug is
     * `invalid`.
     */
    async create(scope: TeacherScope, input: TeacherProfileCreate): Promise<TeacherProfileRow> {
      const method = 'teacherProfiles.create';
      const { teacherId } = teacherScope(scope, method);
      const p = parseArg(CreateInput, input, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          // Share-locked so a concurrent role change can't slip between the check and the insert.
          const role = await lockRole(tx, teacherId);
          if (role === null) throw new RepositoryError('not_found', method);
          if (role !== 'teacher') throw new RepositoryError('scope', method);
          const [row] = await tx
            .insert(teacherProfiles)
            .values({
              userId: teacherId,
              slug: p.slug,
              displayName: p.displayName,
              subject: p.subject,
              ...(p.bio === undefined ? {} : { bio: p.bio }),
              ...(p.languages === undefined ? {} : { languages: p.languages }),
            })
            .returning(columns);
          return toTeacherProfile(row!, method);
        }),
      );
    },

    /** The scope's own profile, or null. */
    async get(scope: TeacherScope): Promise<TeacherProfileRow | null> {
      const method = 'teacherProfiles.get';
      const { teacherId } = teacherScope(scope, method);
      const [row] = await db
        .select(columns)
        .from(teacherProfiles)
        .where(eq(teacherProfiles.userId, teacherId));
      return row ? toTeacherProfile(row, method) : null;
    },

    /**
     * Edits the scope's own profile; `not_found` if it has none. A teacher never sets their own
     * verification, but a subject change (task 8.1c, B-30) sends the profile back to `pending`.
     * The reset is part of the same UPDATE statement: the CASE reads the row's pre-update subject
     * under the row lock the UPDATE already takes, so there is no read-then-write window. A
     * subject equal to the stored one (after the schema's trim) is not a change; bio and
     * languages edits never touch the status.
     */
    async update(scope: TeacherScope, patch: TeacherProfileUpdate): Promise<TeacherProfileRow> {
      const method = 'teacherProfiles.update';
      const { teacherId } = teacherScope(scope, method);
      const p = parseArg(UpdateInput, patch, method);
      const [row] = await db
        .update(teacherProfiles)
        .set({
          ...(p.displayName === undefined ? {} : { displayName: p.displayName }),
          ...(p.subject === undefined
            ? {}
            : {
                subject: p.subject,
                verificationStatus: sql`case when ${teacherProfiles.subject} <> ${p.subject}
                  then 'pending'::teacher_verification_status
                  else ${teacherProfiles.verificationStatus} end`,
              }),
          ...(p.bio === undefined ? {} : { bio: p.bio }),
          ...(p.languages === undefined ? {} : { languages: p.languages }),
        })
        .where(eq(teacherProfiles.userId, teacherId))
        .returning(columns);
      if (!row) throw new RepositoryError('not_found', method);
      return toTeacherProfile(row, method);
    },

    /**
     * Staff verify or reject the scope's teacher (the audit.appendForTeacher precedent: a staff
     * actor writing to one named teacher). In one transaction: `by` must be a user who is staff
     * now (share-locked, like identity.grantRole) and not the teacher themself, else `scope`; the
     * profile is locked and updated; a `teacher.verify` audit row records before and after. No
     * profile is `not_found`.
     *
     * Task 9.3e (B-46 (c)): a rejection with `safety: true` also takes down every one of the
     * teacher's `live` agents in the same transaction (`takeDownAgentInTx`: a `harmful` takedown
     * row per agent whose note is the reason, agent `suspended`, a `takedown.create` audit row),
     * so `agents.owner` is null and every student turn is refused at once. The audit row's
     * `after` then carries `safety: true` and the takedown ids. A live agent that somehow already
     * has an active takedown is only set `suspended` (one active takedown per target). A plain
     * rejection never touches agents: existing subscribers keep access until their plan ends.
     * A later `verified` lifts nothing; staff lift each takedown explicitly.
     *
     * Lock order: the staff user's role row (FOR SHARE) -> the profile (FOR UPDATE) -> the
     * teacher's live agents in ascending id (FOR UPDATE) -> new takedown rows. publish takes
     * advisory -> profile -> agent -> run, and takedowns.create/lift take role -> (profile) ->
     * agent -> takedown -> report: everyone takes the profile before an agent and an agent before
     * a takedown, and nobody holds an agent while waiting on a role or profile row, so no cycle.
     */
    async setVerification(
      scope: TeacherScope,
      input: TeacherVerificationInput,
    ): Promise<TeacherProfileRow> {
      const method = 'teacherProfiles.setVerification';
      const { teacherId } = teacherScope(scope, method);
      const v = parseArg(VerificationInput, input, method);
      if (v.by === teacherId) throw new RepositoryError('scope', method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          if ((await lockRole(tx, v.by)) !== 'staff') throw new RepositoryError('scope', method);
          const [current] = await tx
            .select({ status: teacherProfiles.verificationStatus })
            .from(teacherProfiles)
            .where(eq(teacherProfiles.userId, teacherId))
            .for('update');
          if (!current) throw new RepositoryError('not_found', method);
          const [row] = await tx
            .update(teacherProfiles)
            .set({ verificationStatus: v.status })
            .where(eq(teacherProfiles.userId, teacherId))
            .returning(columns);

          const takenDown: string[] = [];
          if (v.safety === true) {
            const live = await tx
              .select({ id: agents.id, teacherId: agents.teacherId, status: agents.status })
              .from(agents)
              .where(and(eq(agents.teacherId, teacherId), eq(agents.status, 'live')))
              .orderBy(asc(agents.id))
              .for('update');
            for (const agent of live) {
              const [active] = await tx
                .select({ id: takedowns.id })
                .from(takedowns)
                .where(
                  and(eq(takedowns.target, `agent:${agent.id}`), eq(takedowns.status, 'active')),
                );
              if (active) {
                await tx.update(agents).set({ status: 'suspended' }).where(eq(agents.id, agent.id));
                takenDown.push(active.id);
                continue;
              }
              const { id } = await takeDownAgentInTx(
                tx,
                {
                  staff: v.by,
                  agent,
                  category: 'harmful',
                  note: v.reason ?? null,
                  source: 'teacher.verify',
                },
                method,
              );
              takenDown.push(id);
            }
          }

          await insertAuditEntry(tx, method, teacherId, null, {
            actor: v.by,
            actorRole: 'staff',
            action: 'teacher.verify',
            target: `teacher:${teacherId}`,
            ...(v.reason === undefined ? {} : { reason: v.reason }),
            before: { verificationStatus: current.status },
            after:
              v.safety === true
                ? { verificationStatus: v.status, safety: true, takedowns: takenDown }
                : { verificationStatus: v.status },
          });
          return toTeacherProfile(row!, method);
        }),
      );
    },

    /**
     * The publish guard (8.7 calls it before an agent goes live): resolves only when the scope's
     * own profile exists and is `verified`; otherwise `scope`, so an unverified teacher cannot
     * publish.
     */
    async assertVerifiedForPublish(scope: TeacherScope): Promise<void> {
      const method = 'teacherProfiles.assertVerifiedForPublish';
      const { teacherId } = teacherScope(scope, method);
      const [row] = await db
        .select({ status: teacherProfiles.verificationStatus })
        .from(teacherProfiles)
        .where(eq(teacherProfiles.userId, teacherId));
      if (row?.status !== 'verified') throw new RepositoryError('scope', method);
    },

    /**
     * The staff verification queue (task 12.1a): pending teachers, oldest first, capped at
     * `STAFF_QUEUE_MAX_LIMIT`. `by` must be a user who is staff right now (a plain, unlocked read
     * of the role column — this is a read, not a write, so no `FOR SHARE` is needed, unlike
     * `setVerification`'s `by` check). Joins `users` for the declared name and email, same
     * precedent as `identity.getUserByEmail`: staff need them to actually check identity. A
     * malformed `by` is `invalid`; a well-formed `by` that is not staff is `scope`.
     */
    async listPendingForStaff(by: unknown): Promise<TeacherVerificationQueueRow[]> {
      const method = 'teacherProfiles.listPendingForStaff';
      const id = parseArg(IdSchema, by, method);
      const [actor] = await db.select({ role: users.role }).from(users).where(eq(users.id, id));
      if (actor?.role !== 'staff') throw new RepositoryError('scope', method);
      const rows = await db
        .select({
          id: teacherProfiles.id,
          userId: teacherProfiles.userId,
          slug: teacherProfiles.slug,
          subject: teacherProfiles.subject,
          verificationStatus: teacherProfiles.verificationStatus,
          name: users.name,
          email: users.email,
        })
        .from(teacherProfiles)
        .innerJoin(users, eq(users.id, teacherProfiles.userId))
        .where(eq(teacherProfiles.verificationStatus, 'pending'))
        .orderBy(asc(teacherProfiles.createdAt), asc(teacherProfiles.id))
        .limit(STAFF_QUEUE_MAX_LIMIT);
      return rows.map((r) => toTeacherVerificationQueueRow(r, method));
    },

    /**
     * A staff-only lookup by slug, **with no `verificationStatus` filter** (task 9.3f): staff can
     * only reach `setVerification` through a `teacherId` taken from `listPendingForStaff`, which
     * filters to `pending`, so a teacher who is already `verified` or `rejected` could never be
     * named to a safety rejection -- `setVerification` itself has worked from any starting status
     * since 9.3e. This closes that console gap with a read, not a write (no lock, unlike
     * `setVerification`'s own `by` check). A malformed `by` or `slug` is `invalid` before any SQL
     * (both are parsed first, same as every other method); a well-formed `by` who is not staff
     * right now is `scope`; an unknown slug is `null`.
     */
    async findBySlugForStaff(
      by: unknown,
      slug: unknown,
    ): Promise<TeacherVerificationQueueRow | null> {
      const method = 'teacherProfiles.findBySlugForStaff';
      const id = parseArg(IdSchema, by, method);
      const s = parseArg(Slug, slug, method);
      const [actor] = await db.select({ role: users.role }).from(users).where(eq(users.id, id));
      if (actor?.role !== 'staff') throw new RepositoryError('scope', method);
      const [row] = await db
        .select({
          id: teacherProfiles.id,
          userId: teacherProfiles.userId,
          slug: teacherProfiles.slug,
          subject: teacherProfiles.subject,
          verificationStatus: teacherProfiles.verificationStatus,
          name: users.name,
          email: users.email,
        })
        .from(teacherProfiles)
        .innerJoin(users, eq(users.id, teacherProfiles.userId))
        .where(eq(teacherProfiles.slug, s));
      return row ? toTeacherVerificationQueueRow(row, method) : null;
    },
  };
}
