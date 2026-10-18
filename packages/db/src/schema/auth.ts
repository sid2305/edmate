// Sign-in tables (task 1.3): linked OAuth accounts and database sessions. Prefixed `auth_` because
// the learning `sessions` table already exists. Verification tokens (email magic link) are 1.4's.
import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_shared.js';
import { users } from './users.js';

/**
 * A sign-in provider account linked to a user (for example Google's `sub`). No OAuth tokens are
 * stored: Edmate never calls the provider's APIs (1.3 decision Q6).
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
    index('auth_accounts_user_id_idx').on(t.userId),
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
  ],
);
