// Sign-in tables (task 1.3): linked OAuth accounts, database sessions and the platform audit log.
// Prefixed `auth_` because the learning `sessions` table already exists. Email magic-link
// verification tokens were added in 1.4.
import { index, jsonb, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_shared.js';
import { users } from './users.js';

/**
 * A sign-in provider account linked to a user (for example Google's `sub`). No OAuth tokens are
 * stored: Edmate never calls the provider's APIs (1.3 decision Q6). A user has at most one account
 * per provider, so a second Google account can never be attached to someone else's user.
 */
export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** Auth.js account type, for example `oidc`. */
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('auth_accounts_provider_provider_account_id_key').on(
      t.provider,
      t.providerAccountId,
    ),
    // Led by user_id, so it also serves a user's account lookups.
    uniqueIndex('auth_accounts_user_id_provider_key').on(t.userId, t.provider),
  ],
);

/**
 * A signed-in browser. Only the SHA-256 hash of the cookie's session token is stored, so a copy of
 * the database holds no live sessions.
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: id(),
    sessionTokenHash: text('session_token_hash').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: tstz('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('auth_sessions_session_token_hash_key').on(t.sessionTokenHash),
    index('auth_sessions_user_id_idx').on(t.userId),
    // For sweeping expired sessions (retention, 13.4).
    index('auth_sessions_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * An email sign-in link (task 1.4). Only a SHA-256 of the token is stored, so a copy of the
 * database holds no usable link. One row per address (unique `identifier`): a new link replaces
 * the old one, and using a link deletes its row. No foreign key to `users`, because the address
 * may not belong to a user yet.
 */
export const authVerificationTokens = pgTable(
  'auth_verification_tokens',
  {
    id: id(),
    /** The lower-cased email address the link was sent to. */
    identifier: text('identifier').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('auth_verification_tokens_identifier_key').on(t.identifier),
    uniqueIndex('auth_verification_tokens_token_hash_key').on(t.tokenHash),
    // For sweeping expired links (retention, 13.4).
    index('auth_verification_tokens_expires_at_idx').on(t.expiresAt),
  ],
);

/** Who acted at platform level: a staff user, or the operator CLI (no user). */
// Task 13.4: 'student' added so a self-initiated account.delete (identity.anonymise) can be
// audited at the platform level, the same table role.grant already uses.
export const platformActorRole = pgEnum('platform_actor_role', ['staff', 'operator', 'student']);

/**
 * Platform-level audit (task 1.3): staff and operator actions that belong to no teacher, starting
 * with role grants. 1.6's `audit_log` keeps its rule that every row belongs to one teacher, and its
 * scoped reads are unchanged. Append-only: the identity store only inserts here. Reading it is the
 * trust console's job (12.1).
 */
export const platformAuditLog = pgTable(
  'platform_audit_log',
  {
    id: id(),
    /** A staff user id, or `operator`. Not a foreign key: the operator is no user. */
    actor: text('actor').notNull(),
    actorRole: platformActorRole('actor_role').notNull(),
    /** For example `role.grant`. */
    action: text('action').notNull(),
    /** `<kind>:<id>`, for example `user:…`. */
    target: text('target').notNull(),
    /** The user the action is about, when it is about one. */
    subjectUserId: text('subject_user_id').references(() => users.id),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
    ts: tstz('ts').notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index('platform_audit_log_target_ts_idx').on(t.target, t.ts),
    index('platform_audit_log_actor_ts_idx').on(t.actor, t.ts),
    index('platform_audit_log_subject_user_id_ts_idx').on(t.subjectUserId, t.ts),
  ],
);
