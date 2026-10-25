// Identity store (task 1.3): the one path sign-in uses to read and write users, linked accounts
// and database sessions; since 1.4 also email sign-in links. See README.md for its rules; it is deliberately not a repository.
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import {
  authAccounts,
  authSessions,
  authVerificationTokens,
  consents,
  learnerProfiles,
  messages,
  platformAuditLog,
  sessions,
  teacherQuestions,
  users,
} from '../schema/index.js';
import { guarded, RepositoryError, translateWrite } from '../repositories/errors.js';
import { IdSchema, parseArg } from '../repositories/scope.js';
import { hashSessionToken, hashToken } from './token-hash.js';
import {
  type AgeAnswerStatus,
  type AgePolicy,
  ageStatus,
  type AgeStatus,
  DEFAULT_AGE_POLICY,
} from './age.js';

export const ROLES = ['student', 'teacher', 'staff'] as const;

/** The `by` of a grant made from the operator CLI, with no staff user behind it. */
export const OPERATOR = 'operator';
export type Role = (typeof ROLES)[number];

/** Identity fields only: never teacher or student data. */
export interface IdentityUser {
  id: string;
  role: Role;
  email: string | null;
  emailVerifiedAt: Date | null;
  name: string;
}

export interface IdentitySession {
  userId: string;
  expires: Date;
}

/** An email sign-in link as the store hands it back: never the token or its hash. */
export interface IdentityVerificationToken {
  /** The lower-cased address. */
  identifier: string;
  expires: Date;
}

export interface GrantRoleInput {
  userId: string;
  role: Role;
  /** The staff user who granted it, or `operator` for the CLI with no staff account yet. */
  by: string;
  reason?: string;
}

/** The learner's one answer at the age gate (1.7). */
export interface AgeAnswer {
  userId: string;
  /** A market with a locale pack (`IN`, `US`, …), or `global` for "somewhere else". */
  market: string;
  birthYear: number;
  /** The version of the privacy notice the learner was shown and accepted. */
  noticeVersion: string;
}

export interface IdentityStore {
  /** A new user, always a `student` in market `global`, locale `en`. A taken email is `invalid`. */
  createStudent(input: {
    email: string;
    emailVerifiedAt: Date | null;
    name: string;
  }): Promise<IdentityUser>;
  getUser(id: string): Promise<IdentityUser | null>;
  /**
   * The user's own market (9.4a): `global` from signup, the age-gate answer after (1.7). Only the
   * market column is read, so `IdentityUser` stays identity fields. An unknown user is `null`.
   * The caller passes the signed-in principal's own id, never a client-supplied one.
   */
  getMarket(id: string): Promise<string | null>;
  getUserByEmail(email: string): Promise<IdentityUser | null>;
  getUserByAccount(provider: string, providerAccountId: string): Promise<IdentityUser | null>;
  /** The only profile field sign-in may change. An unknown user is `not_found`. */
  markEmailVerified(userId: string, at: Date): Promise<IdentityUser>;
  /** Links a provider account. No OAuth tokens are taken or stored. */
  linkAccount(input: {
    userId: string;
    type: string;
    provider: string;
    providerAccountId: string;
  }): Promise<void>;
  createSession(token: string, userId: string, expires: Date): Promise<IdentitySession>;
  /** The live session and its user; an expired or unknown token is `null`. */
  getSessionAndUser(
    token: string,
  ): Promise<{ session: IdentitySession; user: IdentityUser } | null>;
  /** Moves a live session's expiry; an expired or unknown token is `null`. */
  updateSession(token: string, expires: Date): Promise<IdentitySession | null>;
  deleteSession(token: string): Promise<void>;
  /**
   * Stores a new email sign-in link as `sha256(token)` and, in the same statement, replaces any
   * earlier link for that address: only the newest link works (README rule 11).
   */
  createVerificationToken(input: {
    identifier: string;
    token: string;
    expires: Date;
  }): Promise<IdentityVerificationToken>;
  /**
   * Uses a link: an atomic delete, so of two concurrent uses only one gets the row. An unknown
   * token, one for another address, or an expired one is `null`; an expired row is still deleted.
   */
  useVerificationToken(input: {
    identifier: string;
    token: string;
  }): Promise<IdentityVerificationToken | null>;
  /**
   * The only way a role changes. `by` must be exactly `operator` or a current staff user (else
   * `scope`). Writes a `role.grant` row to `platform_audit_log` in the same transaction.
   */
  grantRole(input: GrantRoleInput): Promise<IdentityUser>;
  /**
   * The age gate (1.7, README rule 12), once per student: a second answer is `invalid` (also once
   * `age_blocked_at` is set), a non-student is `scope`. Under the market's minimum it deletes the
   * sign-in rows and any consent, then the user, in one transaction (`under_age`). When a row the
   * store does not own blocks only the user delete (fix round 1), the sign-in rows stay deleted,
   * the account stays with `age_blocked_at` set, and the status is `erase_blocked`. Otherwise it
   * stores the birth year, market and time, and a `privacy_notice` consent at `noticeVersion`,
   * granted by `self`. With the `noticeVersion` option, a version other than the one shown for the
   * market is `invalid`.
   */
  recordAgeAnswer(input: AgeAnswer): Promise<{ status: AgeAnswerStatus }>;
  /**
   * A learner's standing, read fresh: `under_age` once `age_blocked_at` is set (fix round 1: an
   * under-age erase that a foreign row blocked), `age_needed` before the answer, `parent_needed`
   * for 13-17 in a market that requires consent until a live parental consent (granted by
   * `parent`, not withdrawn), else `clear`. An unknown user is `not_found`; a teacher or staff
   * user is `scope`.
   */
  learnerStatus(userId: string): Promise<AgeStatus>;
  /**
   * Task 13.4 (account delete, Phase A): clears `name`, `email` and `phone` on the student's own
   * row (name becomes a fixed placeholder; `email`/`phone` become null) and the text of every
   * message in every session of theirs, in one transaction. Also deletes the student's own
   * `auth_sessions`, `auth_accounts` and (by the old email) `auth_verification_tokens` rows — a
   * signed-in device must not keep working after delete, mirroring the under-age erase branch of
   * `recordAgeAnswer` above — and clears the free text of theirs that can restate what they said:
   * `sessions.summary`, `learner_profiles.last_summary` (every pair's) and
   * `teacher_questions.text` (every question of theirs). Leaves `safety_alerts`, payments, ledger
   * and `audit_log` untouched (none of those tables store name/email/phone/message text by
   * design — see the task's handoff). Writes one `platform_audit_log` row
   * (`actor: userId`, `actorRole: 'student'`, `action: 'account.delete'`). Idempotent: calling it
   * again on an already-anonymised row changes nothing further (it still writes a new audit row).
   * A non-student user, or no such user, is `scope`/`not_found` — this is the student's own
   * rights method, not a general account-closer.
   */
  anonymise(userId: string): Promise<void>;
}

/** The fixed name an anonymised student's row carries; never a real name again. */
export const ANONYMISED_NAME = '[deleted student]';

export interface IdentityStoreOptions {
  /** Clock for session and sign-in link expiry (tests). */
  now?: () => Date;
  /** The age rule of a market (1.7); defaults to 13+ with consent required for 13-17. */
  agePolicy?: (market: string) => AgePolicy;
  /**
   * The privacy-notice version the server shows for a market (1.7). When set, an age answer with
   * any other version is `invalid` and changes nothing. The web wires it from the loaded notices.
   */
  noticeVersion?: (market: string) => string;
}

const Email = z.string().trim().toLowerCase().pipe(z.email().max(320));
const Name = z.string().trim().max(200);
const When = z.date();
const Token = z.string().min(16).max(512);
const Provider = z.string().min(1).max(64);
const ProviderAccountId = z.string().min(1).max(255);
const RoleSchema = z.enum(ROLES);

const NewStudent = z.strictObject({ email: Email, emailVerifiedAt: When.nullable(), name: Name });
const NewAccount = z.strictObject({
  userId: IdSchema,
  type: z.string().min(1).max(32),
  provider: Provider,
  providerAccountId: ProviderAccountId,
});
const NewVerificationToken = z.strictObject({ identifier: Email, token: Token, expires: When });
const UseVerificationToken = z.strictObject({ identifier: Email, token: Token });
const Grant = z.strictObject({
  userId: IdSchema,
  role: RoleSchema,
  by: IdSchema,
  reason: z.string().min(1).max(500).optional(),
});

const Market = z.string().regex(/^(?:[A-Z]{2}|global)$/);
const NoticeVersion = z.string().min(1).max(64);

const userColumns = {
  id: users.id,
  role: users.role,
  email: users.email,
  emailVerifiedAt: users.emailVerifiedAt,
  name: users.name,
};

/** The single row of an INSERT, or an UPDATE of a locked row, … RETURNING (always present). */
function first<T>(rows: T[]): T {
  return rows[0] as T;
}

interface StoreConfig {
  now: () => Date;
  agePolicy: (market: string) => AgePolicy;
  noticeVersion: ((market: string) => string) | undefined;
}

function storeMethods(db: Db, { now, agePolicy, noticeVersion }: StoreConfig) {
  const Answer = z.strictObject({
    userId: IdSchema,
    market: Market,
    // A year that has not come yet is no birth year.
    birthYear: z
      .number()
      .int()
      .min(1900)
      .max(2100)
      .refine((y) => y <= now().getUTCFullYear()),
    noticeVersion: NoticeVersion,
  });

  /** A live parental consent: granted by a parent and not withdrawn (any notice version). */
  async function hasParentConsent(q: Pick<Db, 'select'>, userId: string): Promise<boolean> {
    const rows = await q
      .select({ id: consents.id })
      .from(consents)
      .where(
        and(
          eq(consents.userId, userId),
          eq(consents.kind, 'parental'),
          eq(consents.grantedBy, 'parent'),
          isNull(consents.withdrawnAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async function userWhere(where: ReturnType<typeof eq>): Promise<IdentityUser | null> {
    const [row] = await db.select(userColumns).from(users).where(where).limit(1);
    return row ?? null;
  }

  return {
    async createStudent(input: unknown): Promise<IdentityUser> {
      const method = 'identity.createStudent';
      const s = parseArg(NewStudent, input, method);
      const rows = await translateWrite(method, () =>
        db
          .insert(users)
          .values({
            email: s.email,
            emailVerifiedAt: s.emailVerifiedAt,
            name: s.name,
            // Fixed here, never taken from input: roles change only through grantRole, and the
            // real market comes from the student's own answer later (1.7), never from IP.
            role: 'student',
            market: 'global',
            locale: 'en',
          })
          .returning(userColumns),
      );
      return first(rows);
    },

    async getUser(id: unknown): Promise<IdentityUser | null> {
      return userWhere(eq(users.id, parseArg(IdSchema, id, 'identity.getUser')));
    },

    async getMarket(id: unknown): Promise<string | null> {
      const userId = parseArg(IdSchema, id, 'identity.getMarket');
      const [row] = await db
        .select({ market: users.market })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.market ?? null;
    },

    async getUserByEmail(email: unknown): Promise<IdentityUser | null> {
      return userWhere(eq(users.email, parseArg(Email, email, 'identity.getUserByEmail')));
    },

    async getUserByAccount(
      provider: unknown,
      providerAccountId: unknown,
    ): Promise<IdentityUser | null> {
      const method = 'identity.getUserByAccount';
      const p = parseArg(Provider, provider, method);
      const a = parseArg(ProviderAccountId, providerAccountId, method);
      const [row] = await db
        .select(userColumns)
        .from(authAccounts)
        .innerJoin(users, eq(users.id, authAccounts.userId))
        .where(and(eq(authAccounts.provider, p), eq(authAccounts.providerAccountId, a)))
        .limit(1);
      return row ?? null;
    },

    async markEmailVerified(userId: unknown, at: unknown): Promise<IdentityUser> {
      const method = 'identity.markEmailVerified';
      const id = parseArg(IdSchema, userId, method);
      const when = parseArg(When, at, method);
      const [row] = await db
        .update(users)
        .set({ emailVerifiedAt: when })
        .where(eq(users.id, id))
        .returning(userColumns);
      if (!row) throw new RepositoryError('not_found', method);
      return row;
    },

    async linkAccount(input: unknown): Promise<void> {
      const method = 'identity.linkAccount';
      const a = parseArg(NewAccount, input, method);
      await translateWrite(method, () => db.insert(authAccounts).values(a));
    },

    async createSession(token: unknown, userId: unknown, expires: unknown) {
      const method = 'identity.createSession';
      const hash = hashSessionToken(parseArg(Token, token, method));
      const id = parseArg(IdSchema, userId, method);
      const exp = parseArg(When, expires, method);
      await translateWrite(method, () =>
        db.insert(authSessions).values({ sessionTokenHash: hash, userId: id, expiresAt: exp }),
      );
      return { userId: id, expires: exp };
    },

    async getSessionAndUser(token: unknown) {
      const hash = hashSessionToken(parseArg(Token, token, 'identity.getSessionAndUser'));
      const [row] = await db
        .select({ ...userColumns, expires: authSessions.expiresAt })
        .from(authSessions)
        .innerJoin(users, eq(users.id, authSessions.userId))
        .where(and(eq(authSessions.sessionTokenHash, hash), gt(authSessions.expiresAt, now())))
        .limit(1);
      if (!row) return null;
      const { expires, ...user } = row;
      return { session: { userId: user.id, expires }, user };
    },

    async updateSession(token: unknown, expires: unknown) {
      const method = 'identity.updateSession';
      const hash = hashSessionToken(parseArg(Token, token, method));
      const exp = parseArg(When, expires, method);
      const [row] = await db
        .update(authSessions)
        .set({ expiresAt: exp })
        .where(and(eq(authSessions.sessionTokenHash, hash), gt(authSessions.expiresAt, now())))
        .returning({ userId: authSessions.userId, expires: authSessions.expiresAt });
      return row ?? null;
    },

    async deleteSession(token: unknown): Promise<void> {
      const hash = hashSessionToken(parseArg(Token, token, 'identity.deleteSession'));
      await db.delete(authSessions).where(eq(authSessions.sessionTokenHash, hash));
    },

    async createVerificationToken(input: unknown): Promise<IdentityVerificationToken> {
      const method = 'identity.createVerificationToken';
      const v = parseArg(NewVerificationToken, input, method);
      const tokenHash = hashToken(v.token);
      // One row per address (unique identifier): the upsert swaps in the new hash in one atomic
      // statement, so concurrent requests can't leave two live links for one address.
      await translateWrite(method, () =>
        db
          .insert(authVerificationTokens)
          .values({ identifier: v.identifier, tokenHash, expiresAt: v.expires })
          .onConflictDoUpdate({
            target: authVerificationTokens.identifier,
            set: { tokenHash, expiresAt: v.expires },
          }),
      );
      return { identifier: v.identifier, expires: v.expires };
    },

    async useVerificationToken(input: unknown): Promise<IdentityVerificationToken | null> {
      const v = parseArg(UseVerificationToken, input, 'identity.useVerificationToken');
      // DELETE … RETURNING is atomic: of two concurrent clicks only one gets the row.
      const [row] = await db
        .delete(authVerificationTokens)
        .where(
          and(
            eq(authVerificationTokens.identifier, v.identifier),
            eq(authVerificationTokens.tokenHash, hashToken(v.token)),
          ),
        )
        .returning({
          identifier: authVerificationTokens.identifier,
          expires: authVerificationTokens.expiresAt,
        });
      // An expired link is used up all the same, and reads as no link.
      if (!row || row.expires.getTime() <= now().getTime()) return null;
      return row;
    },

    async grantRole(input: unknown): Promise<IdentityUser> {
      const method = 'identity.grantRole';
      const g = parseArg(Grant, input, method);
      return db.transaction(async (tx) => {
        // The actor is the operator CLI (exactly `operator`) or a user who is staff now; the row
        // is share-locked so a concurrent demotion can't slip between the check and the grant.
        let actorRole: 'operator' | 'staff' = 'operator';
        if (g.by !== OPERATOR) {
          const [actor] = await tx
            .select({ role: users.role })
            .from(users)
            .where(eq(users.id, g.by))
            .for('share');
          if (actor?.role !== 'staff') throw new RepositoryError('scope', method);
          actorRole = 'staff';
        }
        const [current] = await tx
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, g.userId))
          .for('update');
        if (!current) throw new RepositoryError('not_found', method);
        // The row is locked above, so the update returns it.
        const row = first(
          await tx
            .update(users)
            .set({ role: g.role })
            .where(eq(users.id, g.userId))
            .returning(userColumns),
        );
        // Platform-level audit: a grant belongs to no teacher, so it stays out of audit_log.
        await tx.insert(platformAuditLog).values({
          actor: g.by,
          actorRole,
          action: 'role.grant',
          target: `user:${g.userId}`,
          subjectUserId: g.userId,
          reason: g.reason ?? null,
          before: { role: current.role },
          after: { role: g.role },
        });
        return row;
      });
    },

    async recordAgeAnswer(input: unknown): Promise<{ status: AgeAnswerStatus }> {
      const method = 'identity.recordAgeAnswer';
      const a = parseArg(Answer, input, method);
      // The version must be the one the server shows for this market, never one the form chose.
      if (noticeVersion && noticeVersion(a.market) !== a.noticeVersion) {
        throw new RepositoryError('invalid', method);
      }
      return db.transaction(async (tx) => {
        // Locked, so of two concurrent answers the second sees the first.
        const [user] = await tx
          .select({
            role: users.role,
            email: users.email,
            birthYear: users.birthYear,
            ageBlockedAt: users.ageBlockedAt,
          })
          .from(users)
          .where(eq(users.id, a.userId))
          .for('update');
        if (!user) throw new RepositoryError('not_found', method);
        if (user.role !== 'student') throw new RepositoryError('scope', method);
        // Already answered: a stored birth year (cleared), or a blocked erase (fix round 1) —
        // either way a second answer must not be taken, from this browser or any other.
        if (user.birthYear !== null || user.ageBlockedAt !== null) {
          throw new RepositoryError('invalid', method);
        }
        const status = ageStatus({
          birthYear: a.birthYear,
          policy: agePolicy(a.market),
          parentConsent: await hasParentConsent(tx, a.userId),
          now: now(),
        });
        if (status === 'under_age') {
          // Erase at once (README rule 10, 12): the sign-in rows and any consent belong to this
          // store, so they are deleted whether or not the account itself can be erased.
          await tx.delete(authSessions).where(eq(authSessions.userId, a.userId));
          await tx.delete(authAccounts).where(eq(authAccounts.userId, a.userId));
          if (user.email !== null) {
            await tx
              .delete(authVerificationTokens)
              .where(eq(authVerificationTokens.identifier, user.email));
          }
          await tx.delete(consents).where(eq(consents.userId, a.userId));
          // The user row, in a savepoint (fix round 1): a row the store does not own still
          // pointing at the user (a foreign key) blocks only this delete, not the sign-in rows
          // already removed above. The account then stays, marked `age_blocked_at`, so no other
          // device or fresh sign-in can ever clear the gate for it; staff erase it (12.1).
          try {
            await tx.transaction((sp) =>
              translateWrite(method, () => sp.delete(users).where(eq(users.id, a.userId))),
            );
            return { status };
          } catch (err) {
            if (!(err instanceof RepositoryError) || err.kind !== 'not_found') throw err;
            await tx.update(users).set({ ageBlockedAt: now() }).where(eq(users.id, a.userId));
            return { status: 'erase_blocked' as const };
          }
        }
        await tx
          .update(users)
          .set({ birthYear: a.birthYear, market: a.market, ageConfirmedAt: now() })
          .where(eq(users.id, a.userId));
        await translateWrite(method, () =>
          tx.insert(consents).values({
            userId: a.userId,
            kind: 'privacy_notice',
            version: a.noticeVersion,
            grantedBy: 'self',
          }),
        );
        return { status };
      });
    },

    async learnerStatus(userId: unknown): Promise<AgeStatus> {
      const method = 'identity.learnerStatus';
      const id = parseArg(IdSchema, userId, method);
      const [user] = await db
        .select({
          role: users.role,
          market: users.market,
          birthYear: users.birthYear,
          ageBlockedAt: users.ageBlockedAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!user) throw new RepositoryError('not_found', method);
      // The age gate is for students; teacher and staff age checks come with vetting.
      if (user.role !== 'student') throw new RepositoryError('scope', method);
      // A blocked erase (fix round 1): under-age forever, whatever the stored birth year (none).
      if (user.ageBlockedAt !== null) return 'under_age';
      if (user.birthYear === null) return 'age_needed';
      const status = ageStatus({
        birthYear: user.birthYear,
        policy: agePolicy(user.market),
        parentConsent: await hasParentConsent(db, id),
        now: now(),
      });
      // Below a minimum the market raised after the answer: never clear (staff decide, 12.1).
      return status === 'under_age' ? 'parent_needed' : status;
    },

    async anonymise(userId: unknown): Promise<void> {
      const method = 'identity.anonymise';
      const id = parseArg(IdSchema, userId, method);
      await db.transaction(async (tx) => {
        // Locked, so a concurrent grant/erase can't slip in between the check and the write.
        const [current] = await tx
          .select({ role: users.role, email: users.email })
          .from(users)
          .where(eq(users.id, id))
          .for('update');
        if (!current) throw new RepositoryError('not_found', method);
        if (current.role !== 'student') throw new RepositoryError('scope', method);
        await tx
          .update(users)
          .set({ name: ANONYMISED_NAME, email: null, phone: null })
          .where(eq(users.id, id));
        // A signed-in device must not keep working after delete: the same rows
        // `recordAgeAnswer`'s under-age branch erases.
        await tx.delete(authSessions).where(eq(authSessions.userId, id));
        await tx.delete(authAccounts).where(eq(authAccounts.userId, id));
        if (current.email !== null) {
          await tx
            .delete(authVerificationTokens)
            .where(eq(authVerificationTokens.identifier, current.email));
        }
        // The student's own message text, in every session they took part in (never
        // safety_alerts/payments/ledger/audit_log: none of those store name/email/phone/message
        // text by design).
        const theirSessions = tx
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.studentId, id));
        await tx
          .update(messages)
          .set({ text: '' })
          .where(inArray(messages.sessionId, theirSessions));
        // Free text of theirs that can restate what they said: a session's end-of-session recap,
        // the pair's rolling recap, and any question they asked a teacher.
        await tx
          .update(sessions)
          .set({ summary: null })
          .where(eq(sessions.studentId, id));
        await tx
          .update(learnerProfiles)
          .set({ lastSummary: null })
          .where(eq(learnerProfiles.studentId, id));
        await tx
          .update(teacherQuestions)
          .set({ text: '' })
          .where(eq(teacherQuestions.studentId, id));
        await tx.insert(platformAuditLog).values({
          actor: id,
          actorRole: 'student',
          action: 'account.delete',
          target: `user:${id}`,
          subjectUserId: id,
        });
      });
    },
  };
}

type Methods = Record<string, (...args: never[]) => Promise<unknown>>;

/** Every method behind `guarded`, so no driver error leaves unscrubbed (README rule 10). */
function guardAll<T extends Methods>(methods: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(methods)) {
    const call = fn as (...args: unknown[]) => Promise<unknown>;
    out[name] = (...args: unknown[]) => guarded(`identity.${name}`, () => call(...args));
  }
  return out as T;
}

/** The identity store over a database (see README.md). */
export function createIdentityStore(db: Db, options: IdentityStoreOptions = {}): IdentityStore {
  const config: StoreConfig = {
    now: options.now ?? (() => new Date()),
    agePolicy: options.agePolicy ?? (() => DEFAULT_AGE_POLICY),
    noticeVersion: options.noticeVersion,
  };
  return guardAll(storeMethods(db, config)) as unknown as IdentityStore;
}
