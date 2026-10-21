// Teacher profiles (task 8.1): a teacher creates, reads and edits their own profile; only a
// current staff user can verify or reject it; and an unverified teacher cannot publish. A teacher
// never sets their own verification: no teacher-facing input has a `verificationStatus` key, and
// the input objects are strict, so such a key is `invalid` before any SQL.
//
// `photo` has no input yet (the column stays null until a storage port exists, 8.2 or later) and
// `payoutAccountRef` belongs to payments (M10); neither is read or written here.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { lockRole } from '../role-lock.js';
import { teacherProfiles } from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { RepositoryError, translateWrite } from './errors.js';
import { toTeacherProfile, type TeacherProfileRow } from './map.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

/** Lower-case words joined by single hyphens, 3 to 60 characters: it appears in public URLs. */
const Slug = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const Subject = z.string().trim().min(1).max(100);
const Bio = z.string().max(2000);
/** BCP 47-style tags such as `en` or `pt-BR`. */
const Languages = z.array(z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)).max(10);

const CreateInput = z.strictObject({
  slug: Slug,
  subject: Subject,
  bio: Bio.optional(),
  languages: Languages.optional(),
});

/** What a teacher may edit. No verificationStatus, payoutAccountRef, photo or slug key. */
const UpdateInput = z
  .strictObject({
    subject: Subject.optional(),
    bio: Bio.optional(),
    languages: Languages.optional(),
  })
  .refine((p) => Object.keys(p).length > 0);

/** Staff decide `verified` or `rejected`; `pending` is only the starting state. */
const VerificationInput = z.strictObject({
  status: z.enum(['verified', 'rejected']),
  by: IdSchema,
  reason: z.string().min(1).max(500).optional(),
});

export type TeacherProfileCreate = z.infer<typeof CreateInput>;
export type TeacherProfileUpdate = z.infer<typeof UpdateInput>;
export type TeacherVerificationInput = z.infer<typeof VerificationInput>;

const columns = {
  id: teacherProfiles.id,
  userId: teacherProfiles.userId,
  slug: teacherProfiles.slug,
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

    /** Edits the scope's own profile; `not_found` if it has none. Never touches verification. */
    async update(scope: TeacherScope, patch: TeacherProfileUpdate): Promise<TeacherProfileRow> {
      const method = 'teacherProfiles.update';
      const { teacherId } = teacherScope(scope, method);
      const p = parseArg(UpdateInput, patch, method);
      const [row] = await db
        .update(teacherProfiles)
        .set({
          ...(p.subject === undefined ? {} : { subject: p.subject }),
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
     */
    async setVerification(
      scope: TeacherScope,
      input: TeacherVerificationInput,
    ): Promise<TeacherProfileRow> {
      const method = 'teacherProfiles.setVerification';
      const { teacherId } = teacherScope(scope, method);
      const v = parseArg(VerificationInput, input, method);
      if (v.by === teacherId) throw new RepositoryError('scope', method);
      return db.transaction(async (tx) => {
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
        await insertAuditEntry(tx, method, teacherId, null, {
          actor: v.by,
          actorRole: 'staff',
          action: 'teacher.verify',
          target: `teacher:${teacherId}`,
          ...(v.reason === undefined ? {} : { reason: v.reason }),
          before: { verificationStatus: current.status },
          after: { verificationStatus: v.status },
        });
        return toTeacherProfile(row!, method);
      });
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
  };
}
