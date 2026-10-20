// Identity store (task 1.3): the one path sign-in uses to read and write users, linked accounts
// and database sessions; since 1.4 also email sign-in links. See README.md for its rules; it is deliberately not a repository.
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import {
  authAccounts,
  authSessions,
  authVerificationTokens,
  platformAuditLog,
  users,
} from '../schema/index.js';
import { guarded, RepositoryError, translateWrite } from '../repositories/errors.js';
import { IdSchema, parseArg } from '../repositories/scope.js';
import { hashSessionToken, hashToken } from './token-hash.js';

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

export interface IdentityStore {
  /** A new user, always a `student` in market `global`, locale `en`. A taken email is `invalid`. */
  createStudent(input: {
    email: string;
    emailVerifiedAt: Date | null;
    name: string;
  }): Promise<IdentityUser>;
  getUser(id: string): Promise<IdentityUser | null>;
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
}

export interface IdentityStoreOptions {
  /** Clock for session and sign-in link expiry (tests). */
  now?: () => Date;
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

function storeMethods(db: Db, now: () => Date) {
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
  const now = options.now ?? (() => new Date());
  return guardAll(storeMethods(db, now)) as unknown as IdentityStore;
}
